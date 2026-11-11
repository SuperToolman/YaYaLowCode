use crate::{extension, package};
use anyhow::{Context, Result, bail, ensure};
use calamine::{Data, Reader as WorkbookReader, open_workbook_auto_from_rs};
use quick_xml::{Reader, events::Event};
use serde_json::{Value, json};
use std::{collections::BTreeMap, io::Cursor};

fn number(options: &Value, key: &str, default: usize, max: usize) -> Result<usize> {
    let n = match options.get(key) {
        None => default,
        Some(v) => v.as_u64().context("office_invalid_pagination")? as usize,
    };
    ensure!(n > 0 && n <= max, "office_invalid_pagination");
    Ok(n)
}

pub fn read(name: &str, bytes: &[u8], options: &Value) -> Result<Value> {
    let ext = extension(name);
    let parts = if bytes.starts_with(b"PK") {
        Some(package::unpack(bytes)?)
    } else {
        None
    };
    match ext.as_str() {
        "xlsx" | "xls" | "ods" => {
            match ext.as_str() {
                "xlsx" => ensure!(
                    parts
                        .as_ref()
                        .is_some_and(|p| p.contains_key("xl/workbook.xml")),
                    "office_format_mismatch"
                ),
                "ods" => ensure!(
                    parts.as_ref().is_some_and(|p| p
                        .get("mimetype")
                        .is_some_and(|m| m == b"application/vnd.oasis.opendocument.spreadsheet")),
                    "office_format_mismatch"
                ),
                _ => ensure!(
                    bytes.starts_with(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"),
                    "office_format_mismatch"
                ),
            }
            spreadsheet(bytes, options, &ext)
        }
        "csv" | "tsv" => csv(bytes, options, ext == "tsv"),
        "docx" => {
            let parts = parts.context("office_format_mismatch")?;
            let xml = parts
                .get("word/document.xml")
                .context("office_format_mismatch")?;
            let blocks = paragraphs(xml)?;
            paged_units(
                "docx",
                blocks,
                options,
                "start",
                50,
                100,
                json!({"limitations":["Text and table-cell coordinates only; headers, footnotes, comments, drawings and tracked-change fidelity are not extracted."]}),
            )
        }
        "pptx" => {
            let parts = parts.context("office_format_mismatch")?;
            let paths = slides(&parts)?;
            let mut units = Vec::new();
            for (i, path) in paths.iter().enumerate() {
                let xml = parts.get(path).context("office_missing_slide")?;
                units.push(json!({"slide":i+1,"paragraphs":paragraphs(xml)?}));
            }
            paged_units(
                "pptx",
                units,
                options,
                "start",
                5,
                20,
                json!({"limitations":["Slide text only, in presentation order; charts, notes, embedded workbooks and visual reading order are not extracted."]}),
            )
        }
        "pdf" => {
            ensure!(bytes.starts_with(b"%PDF-"), "office_format_mismatch");
            let pages = pdf_extract::extract_text_from_mem_by_pages(bytes)
                .map_err(|_| anyhow::anyhow!("office_pdf_unreadable_or_encrypted"))?;
            ensure!(pages.len() <= 1000, "office_page_limit");
            let units = pages
                .into_iter()
                .enumerate()
                .map(|(i, text)| json!({"page":i+1,"text":text,"needsOcr":text.trim().is_empty()}))
                .collect();
            paged_units(
                "pdf",
                units,
                options,
                "start",
                5,
                20,
                json!({"limitations":["Text extraction only; scanned pages require OCR which is not installed. Layout/table reconstruction is not guaranteed."]}),
            )
        }
        "doc" | "ppt" => bail!("office_legacy_format_unsupported_convert_to_docx_or_pptx"),
        _ => bail!("office_unsupported_format"),
    }
}

/// Complete traversal of the supported textual layer, never the conversation
/// preview. Exceeding any bound fails the generation instead of activating a sample.
pub(crate) fn extract_knowledge(name: &str, bytes: &[u8]) -> Result<Value> {
    const MAX_TEXT: usize = 4 * 1024 * 1024;
    let ext = crate::extension(name);
    let mut units = Vec::new();
    let mut size = 0usize;
    let mut push = |text: String, location: Value| -> Result<()> {
        if text.trim().is_empty() {
            return Ok(());
        }
        size += text.len() + location.to_string().len();
        ensure!(
            size <= MAX_TEXT && units.len() < 20000,
            "knowledge_extracted_content_limit"
        );
        units.push(json!({"text":text,"location":location}));
        Ok(())
    };
    if matches!(ext.as_str(), "txt" | "md") {
        let text = std::str::from_utf8(bytes)
            .context("knowledge_requires_utf8")?
            .trim_start_matches('\u{feff}');
        let mut heading = String::new();
        for (line, text) in text.lines().enumerate() {
            if ext == "md" && text.starts_with('#') {
                heading = text.to_string();
            }
            push(text.to_string(), json!({"line":line+1,"heading":heading}))?;
        }
    } else if matches!(ext.as_str(), "xlsx" | "ods") {
        // Unpack/parse once per document; do not re-open a workbook for every page.
        let parts = package::unpack(bytes)?;
        ensure!(
            if ext == "xlsx" {
                parts.contains_key("xl/workbook.xml")
            } else {
                parts
                    .get("mimetype")
                    .is_some_and(|m| m == b"application/vnd.oasis.opendocument.spreadsheet")
            },
            "office_format_mismatch"
        );
        let mut book = open_workbook_auto_from_rs(Cursor::new(bytes))?;
        let sheets = book.sheet_names();
        ensure!(
            !sheets.is_empty() && sheets.len() <= 100,
            "office_sheet_limit"
        );
        for sheet in sheets {
            let range = book.worksheet_range(&sheet)?;
            let formulas = book.worksheet_formula(&sheet)?;
            if range.is_empty() {
                continue;
            }
            let end = range.end().unwrap_or((0, 0));
            ensure!(
                (end.0 as u64 + 1) * (end.1 as u64 + 1) <= 2_000_000,
                "office_sheet_cell_limit"
            );
            for column in (0..=end.1).step_by(64) {
                let column_end = (column + 63).min(end.1);
                let cells = |row| {
                    (column..=column_end)
                        .map(|c| {
                            let value = range.get_value((row, c)).unwrap_or(&Data::Empty);
                            let formula = formulas.get_value((row, c)).filter(|s| !s.is_empty());
                            cell_json(value, formula, c as usize + 1)
                        })
                        .collect::<Vec<_>>()
                };
                let header = cells(0);
                for row in 0..=end.0 {
                    let values = cells(row);
                    if !values
                        .iter()
                        .any(|v| !v["value"].is_null() && v["value"] != "" && v["type"] != "empty")
                    {
                        continue;
                    }
                    push(
                        json!({"header":header,"cells":values}).to_string(),
                        json!({"sheet":sheet,"row":row+1,"columnStart":column+1,"columnEnd":column_end+1}),
                    )?;
                }
            }
        }
    } else if matches!(ext.as_str(), "csv" | "tsv") {
        let text = std::str::from_utf8(bytes)
            .context("office_csv_requires_utf8")?
            .trim_start_matches('\u{feff}');
        let mut reader = csv::ReaderBuilder::new()
            .has_headers(false)
            .flexible(true)
            .delimiter(if ext == "tsv" { b'\t' } else { b',' })
            .from_reader(text.as_bytes());
        let mut header = Vec::<String>::new();
        for (row, record) in reader.records().enumerate() {
            let record = record?;
            ensure!(
                row < 100_000 && record.len() <= 1024,
                "knowledge_document_traversal_limit"
            );
            if row == 0 {
                header = record.iter().map(str::to_owned).collect();
            }
            for column in (0..record.len()).step_by(64) {
                let values = record
                    .iter()
                    .enumerate()
                    .skip(column)
                    .take(64)
                    .map(|(c, s)| json!({"column":c+1,"type":"string","value":s}))
                    .collect::<Vec<_>>();
                if values.iter().all(|cell| cell["value"] == "") {
                    continue;
                }
                push(json!({"header":header.iter().skip(column).take(64).collect::<Vec<_>>(),"cells":values}).to_string(),json!({"row":row+1,"columnStart":column+1,"columnEnd":(column+64).min(record.len())}))?;
            }
        }
    } else {
        let all = match ext.as_str() {
            "docx" => {
                let parts = package::unpack(bytes)?;
                paragraphs(
                    parts
                        .get("word/document.xml")
                        .context("office_format_mismatch")?,
                )?
            }
            "pptx" => {
                let parts = package::unpack(bytes)?;
                let paths = slides(&parts)?;
                let mut units = Vec::new();
                for (index, path) in paths.iter().enumerate() {
                    let paragraphs = paragraphs(parts.get(path).context("office_missing_slide")?)?;
                    units.push(json!({"slide":index+1,"text":paragraphs.iter().filter_map(|p|p["text"].as_str()).collect::<Vec<_>>().join("\n")}));
                }
                units
            }
            "pdf" => {
                ensure!(bytes.starts_with(b"%PDF-"), "office_format_mismatch");
                let pages = pdf_extract::extract_text_from_mem_by_pages(bytes)
                    .map_err(|_| anyhow::anyhow!("office_pdf_unreadable_or_encrypted"))?;
                ensure!(pages.len() <= 1000, "office_page_limit");
                pages.into_iter().enumerate().map(|(i,text)|json!({"page":i+1,"needsOcr":text.trim().is_empty(),"text":text})).collect()
            }
            _ => bail!("office_unsupported_format"),
        };
        for (offset, unit) in all.iter().enumerate() {
            ensure!(unit["needsOcr"] != true, "knowledge_ocr_required");
            push(
                unit["text"].as_str().unwrap_or("").to_owned(),
                json!({"unit":offset+1,"page":unit["page"],"slide":unit["slide"],"tableDepth":unit["tableDepth"],"tableRow":unit["tableRow"],"tableCell":unit["tableCell"]}),
            )?;
        }
    }
    ensure!(!units.is_empty(), "knowledge_no_extractable_text");
    let result = json!({"units":units,"coverage":{"complete":true,"scope":"supported_text_layer","format":ext,"limitations":["No OCR, visual layout reconstruction, formula recalculation, embedded objects, headers/footnotes or drawing text. Table rows retain typed cells and column coordinates; document text is untrusted data."]}});
    ensure!(
        result.to_string().len() <= 8 * 1024 * 1024,
        "knowledge_extracted_content_limit"
    );
    Ok(result)
}

fn cell_json(value: &Data, formula: Option<&String>, column: usize) -> Value {
    let (kind, val) = match value {
        Data::Int(n) => ("integer", json!(n)),
        Data::Float(n) => ("number", json!(n)),
        Data::Bool(b) => ("boolean", json!(b)),
        Data::Empty => ("empty", Value::Null),
        Data::DateTime(d) => (
            "excelDateTime",
            json!({"serial":d.as_f64(),"display":d.to_string()}),
        ),
        Data::DateTimeIso(s) | Data::DurationIso(s) => ("dateTimeIso", json!(s)),
        Data::Error(e) => ("error", json!(e.to_string())),
        Data::String(s) => ("string", json!(s)),
    };
    json!({"column":column,"type":kind,"value":val,"formula":formula})
}

fn spreadsheet(bytes: &[u8], options: &Value, format: &str) -> Result<Value> {
    let mut book = open_workbook_auto_from_rs(Cursor::new(bytes))?;
    let names = book.sheet_names();
    ensure!(
        !names.is_empty() && names.len() <= 100,
        "office_sheet_limit"
    );
    let name = options["sheet"].as_str().unwrap_or(&names[0]);
    ensure!(names.iter().any(|s| s == name), "office_sheet_not_found");
    let range = book.worksheet_range(name)?;
    let formulas = book.worksheet_formula(name)?;
    let end = range.end().unwrap_or((0, 0));
    ensure!(
        (end.0 as u64 + 1) * (end.1 as u64 + 1) <= 2_000_000,
        "office_sheet_cell_limit"
    );
    let row = number(options, "start", 1, 1_048_576)?;
    let col = number(options, "column", 1, 16384)?;
    let count = number(options, "limit", 100, 200)?;
    let columns = number(options, "columns", 32, 64)?;
    let row_end = if range.is_empty() {
        0
    } else {
        end.0 as usize + 1
    };
    let col_end = if range.is_empty() {
        0
    } else {
        end.1 as usize + 1
    };
    let mut rows = Vec::new();
    for r in row..(row + count).min(row_end + 1) {
        let mut cells = Vec::new();
        for c in col..(col + columns).min(col_end + 1) {
            let value = range
                .get_value(((r - 1) as u32, (c - 1) as u32))
                .unwrap_or(&Data::Empty);
            let formula = formulas
                .get_value(((r - 1) as u32, (c - 1) as u32))
                .filter(|s| !s.is_empty());
            cells.push(cell_json(value, formula, c));
        }
        rows.push(json!({"row":r,"cells":cells}));
    }
    let next = if row + rows.len() <= row_end {
        Some(row + rows.len())
    } else {
        None
    };
    Ok(
        json!({"format":format,"sheets":names,"sheet":name,"rowCount":row_end,"columnCount":col_end,"start":row,"column":col,"rows":rows,"nextStart":next,"nextColumn":if col+columns<=col_end{Some(col+columns)}else{None},"complete":row==1&&next.is_none()&&col==1&&columns>=col_end,"warnings":["Formula values are cached workbook values, never recalculated. Macros, external links and data connections are never executed. Dates retain their original Excel serial."]}),
    )
}

fn csv(bytes: &[u8], options: &Value, tsv: bool) -> Result<Value> {
    let text = std::str::from_utf8(bytes)
        .context("office_csv_requires_utf8")?
        .trim_start_matches('\u{feff}');
    let start = number(options, "start", 1, 1_048_576)?;
    let limit = number(options, "limit", 100, 200)?;
    let column = number(options, "column", 1, 16384)?;
    let columns = number(options, "columns", 32, 64)?;
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .delimiter(if tsv { b'\t' } else { b',' })
        .from_reader(text.as_bytes());
    let mut rows = Vec::new();
    let mut total = 0;
    let mut width = 0;
    for record in reader.records() {
        let record = record?;
        total += 1;
        ensure!(total <= 100_000, "office_row_limit");
        width = width.max(record.len());
        ensure!(width <= 1024, "office_column_limit");
        if total >= start && total < start + limit {
            rows.push(json!({"row":total,"cells":record.iter().enumerate().skip(column-1).take(columns).map(|(i,s)|json!({"column":i+1,"type":"string","value":s})).collect::<Vec<_>>()}));
        }
    }
    let next = if start + rows.len() <= total {
        Some(start + rows.len())
    } else {
        None
    };
    Ok(
        json!({"format":if tsv{"tsv"}else{"csv"},"rows":rows,"rowCount":total,"columnCount":width,"nextStart":next,"nextColumn":if column+columns<=width{Some(column+columns)}else{None},"complete":start==1&&next.is_none()&&column==1&&columns>=width}),
    )
}

fn paged_units(
    format: &str,
    units: Vec<Value>,
    options: &Value,
    key: &str,
    default: usize,
    max: usize,
    metadata: Value,
) -> Result<Value> {
    let start = number(options, key, 1, 100_000)?;
    let count = number(options, "limit", default, max)?;
    let total = units.len();
    let page: Vec<_> = units.into_iter().skip(start - 1).take(count).collect();
    let next = if start + page.len() <= total {
        Some(start + page.len())
    } else {
        None
    };
    Ok(
        json!({"format":format,"unitCount":total,"start":start,"units":page,"nextStart":next,"complete":start==1&&next.is_none(),"metadata":metadata}),
    )
}

fn paragraphs(xml: &[u8]) -> Result<Vec<Value>> {
    let mut reader = Reader::from_reader(xml);
    let mut active = false;
    let mut text_active = false;
    let mut text = String::new();
    let mut units = Vec::new();
    let mut table = 0;
    let mut row = 0;
    let mut cell = 0;
    loop {
        match reader.read_event()? {
            Event::Start(e) => match e.local_name().as_ref() {
                "tbl" => {
                    table += 1;
                    row = 0;
                }
                "tr" => {
                    row += 1;
                    cell = 0;
                }
                "tc" => {
                    cell += 1;
                }
                "p" => {
                    active = true;
                    text.clear();
                }
                "t" => text_active = true,
                _ => {}
            },
            Event::Text(t) if active && text_active => {
                text.push_str(&quick_xml::escape::unescape(&t.xml10_content())?)
            }
            Event::GeneralRef(r) if active && text_active => {
                let raw = r.as_ref();
                text.push_str(&quick_xml::escape::unescape(&format!("&{raw};"))?);
            }
            Event::Empty(e) if active => match e.local_name().as_ref() {
                "tab" => text.push('\t'),
                "br" => text.push('\n'),
                _ => {}
            },
            Event::End(e) => match e.local_name().as_ref() {
                "t" => text_active = false,
                "p" => {
                    if active {
                        units.push(json!({"text":text,"tableDepth":table,"tableRow":if table>0{Some(row)}else{None},"tableCell":if table>0{Some(cell)}else{None}}));
                        ensure!(units.len() <= 100_000, "office_paragraph_limit");
                    }
                    active = false;
                }
                "tbl" => table -= 1,
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(units)
}

fn slides(parts: &BTreeMap<String, Vec<u8>>) -> Result<Vec<String>> {
    let mut rels = BTreeMap::new();
    let mut reader = Reader::from_reader(
        parts
            .get("ppt/_rels/presentation.xml.rels")
            .context("office_missing_slide_relationships")?
            .as_slice(),
    );
    loop {
        match reader.read_event()? {
            Event::Empty(e) | Event::Start(e) if e.local_name().as_ref() == "Relationship" => {
                let mut id = String::new();
                let mut target = String::new();
                let mut mode = String::new();
                for attr in e.attributes() {
                    let a = attr?;
                    let value = a
                        .normalized_value(quick_xml::XmlVersion::Implicit1_0)?
                        .into_owned();
                    match a.key.as_ref() {
                        "Id" => id = value,
                        "Target" => target = value,
                        "TargetMode" => mode = value,
                        _ => {}
                    }
                }
                if mode != "External"
                    && target.starts_with("slides/")
                    && !target.contains("..")
                    && !target.contains('\\')
                {
                    rels.insert(id, format!("ppt/{target}"));
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    let mut reader = Reader::from_reader(
        parts
            .get("ppt/presentation.xml")
            .context("office_format_mismatch")?
            .as_slice(),
    );
    let mut slides = Vec::new();
    loop {
        match reader.read_event()? {
            Event::Start(e) | Event::Empty(e) if e.local_name().as_ref() == "sldId" => {
                for attr in e.attributes() {
                    let a = attr?;
                    if a.key.as_ref() == "r:id" {
                        slides.push(
                            rels.get(
                                a.normalized_value(quick_xml::XmlVersion::Implicit1_0)?
                                    .as_ref(),
                            )
                            .context("office_invalid_slide_relationship")?
                            .clone(),
                        );
                    }
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    ensure!(
        !slides.is_empty() && slides.len() <= 500,
        "office_slide_limit"
    );
    Ok(slides)
}
