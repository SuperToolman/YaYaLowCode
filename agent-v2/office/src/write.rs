use crate::{
    extension,
    package::{escape, zip},
};
use anyhow::{Context, Result, bail, ensure};
use rust_xlsxwriter::{Color, DocProperties, ExcelDateTime, Format, Workbook};
use serde_json::Value;
const RELS: &str = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CONTENT: &str = "http://schemas.openxmlformats.org/package/2006/content-types";
const W: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const P: &str = "http://schemas.openxmlformats.org/presentationml/2006/main";
const A: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
fn text(v: &Value) -> Result<&str> {
    let s = v.as_str().context("office_expected_text")?;
    ensure!(s.len() <= 32767, "office_text_limit");
    Ok(s)
}
fn keys(v: &Value, allowed: &[&str]) -> Result<()> {
    let obj = v.as_object().context("office_expected_object")?;
    ensure!(
        obj.keys().all(|k| allowed.contains(&k.as_str())),
        "office_unknown_document_field"
    );
    Ok(())
}
pub fn write(name: &str, document: &Value) -> Result<Vec<u8>> {
    match extension(name).as_str() {
        "xlsx" => xlsx(document),
        "docx" => docx(document),
        "pptx" => pptx(document),
        _ => bail!("office_output_format_supported_xlsx_docx_pptx"),
    }
}
fn xlsx(document: &Value) -> Result<Vec<u8>> {
    keys(document, &["sheets"])?;
    let sheets = document["sheets"]
        .as_array()
        .context("office_missing_sheets")?;
    ensure!(
        !sheets.is_empty() && sheets.len() <= 10,
        "office_sheet_limit"
    );
    let mut book = Workbook::new();
    let mut count = 0;
    // Stable archive bytes are required when a committed output is regenerated after a crash.
    book.set_properties(
        &DocProperties::new().set_creation_datetime(&ExcelDateTime::from_ymd(2000, 1, 1)?),
    );
    let header = Format::new()
        .set_bold()
        .set_background_color(Color::RGB(0xE2E3E5));
    for definition in sheets {
        keys(definition, &["name", "rows", "header"])?;
        if let Some(v) = definition.get("header") {
            ensure!(v.is_boolean(), "office_invalid_header");
        }
        let rows = definition["rows"]
            .as_array()
            .context("office_missing_rows")?;
        ensure!(!rows.is_empty() && rows.len() <= 10000, "office_row_limit");
        let sheet = book.add_worksheet();
        sheet.set_name(text(&definition["name"])?)?;
        let mut width = 0;
        for (r, row) in rows.iter().enumerate() {
            let cells = row.as_array().context("office_expected_row_array")?;
            ensure!(cells.len() <= 128, "office_column_limit");
            width = width.max(cells.len());
            count += cells.len();
            ensure!(count <= 10000, "office_cell_limit");
            for (c, value) in cells.iter().enumerate() {
                let r = r as u32;
                let c = c as u16;
                match value {
                    Value::Null => {}
                    Value::Bool(b) => {
                        sheet.write_boolean(r, c, *b)?;
                    }
                    Value::Number(n) => {
                        let n = n.as_f64().context("office_invalid_number")?;
                        ensure!(
                            n.is_finite() && n.abs() <= 9_007_199_254_740_991.0,
                            "office_number_precision_use_string"
                        );
                        sheet.write_number(r, c, n)?;
                    }
                    Value::String(s) => {
                        text(value)?;
                        sheet.write_string(r, c, s)?;
                    }
                    _ => bail!("office_cells_must_be_scalar_values_no_formula_execution"),
                }
            }
        }
        if definition["header"] == true {
            sheet.set_row_format(0, &header)?;
            sheet.set_freeze_panes(1, 0)?;
        }
        for c in 0..width {
            sheet.set_column_width(c as u16, 20)?;
        }
    }
    Ok(book.save_to_buffer()?)
}
fn paragraph(s: &str, style: Option<&str>) -> Result<String> {
    let property = style
        .map(|s| format!("<w:pPr><w:pStyle w:val=\"{s}\"/></w:pPr>"))
        .unwrap_or_default();
    Ok(format!(
        "<w:p>{property}<w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>",
        escape(s)?
    ))
}
fn docx(document: &Value) -> Result<Vec<u8>> {
    keys(document, &["title", "paragraphs", "tables"])?;
    let mut body = String::new();
    if let Some(title) = document.get("title") {
        body.push_str(&paragraph(text(title)?, Some("Title"))?);
    }
    if let Some(paragraphs) = document.get("paragraphs") {
        let paragraphs = paragraphs
            .as_array()
            .context("office_expected_paragraphs")?;
        ensure!(paragraphs.len() <= 1000, "office_paragraph_limit");
        for p in paragraphs {
            body.push_str(&paragraph(text(p)?, None)?);
        }
    }
    if let Some(tables) = document.get("tables") {
        let tables = tables.as_array().context("office_expected_tables")?;
        ensure!(tables.len() <= 20, "office_table_limit");
        for table in tables {
            keys(table, &["rows"])?;
            let rows = table["rows"].as_array().context("office_expected_rows")?;
            ensure!(
                !rows.is_empty() && rows.len() <= 200,
                "office_table_row_limit"
            );
            let width = rows[0]
                .as_array()
                .context("office_expected_row_array")?
                .len();
            ensure!(width > 0 && width <= 12, "office_table_column_limit");
            body.push_str("<w:tbl><w:tblPr><w:tblW w:w=\"0\" w:type=\"auto\"/><w:tblBorders><w:top w:val=\"single\"/><w:left w:val=\"single\"/><w:bottom w:val=\"single\"/><w:right w:val=\"single\"/><w:insideH w:val=\"single\"/><w:insideV w:val=\"single\"/></w:tblBorders></w:tblPr><w:tblGrid>");
            for _ in 0..width {
                body.push_str(&format!("<w:gridCol w:w=\"{}\"/>", 9360 / width));
            }
            body.push_str("</w:tblGrid>");
            for row in rows {
                let cells = row.as_array().context("office_expected_row_array")?;
                ensure!(
                    cells.len() == width,
                    "office_table_rows_must_be_rectangular"
                );
                body.push_str("<w:tr>");
                for cell in cells {
                    body.push_str(&format!(
                        "<w:tc><w:tcPr><w:tcW w:w=\"{}\" w:type=\"dxa\"/></w:tcPr>{}</w:tc>",
                        9360 / width,
                        paragraph(text(cell)?, None)?
                    ));
                }
                body.push_str("</w:tr>");
            }
            body.push_str("</w:tbl>");
        }
    }
    ensure!(!body.is_empty(), "office_empty_document");
    zip(vec![
        (
            "[Content_Types].xml".into(),
            format!(
                "<Types xmlns=\"{CONTENT}\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/><Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/></Types>"
            ),
        ),
        (
            "_rels/.rels".into(),
            format!(
                "<Relationships xmlns=\"{RELS}\"><Relationship Id=\"rId1\" Type=\"{OFFICE}/officeDocument\" Target=\"word/document.xml\"/></Relationships>"
            ),
        ),
        (
            "word/_rels/document.xml.rels".into(),
            format!(
                "<Relationships xmlns=\"{RELS}\"><Relationship Id=\"rId1\" Type=\"{OFFICE}/styles\" Target=\"styles.xml\"/></Relationships>"
            ),
        ),
        (
            "word/styles.xml".into(),
            format!(
                "<w:styles xmlns:w=\"{W}\"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii=\"Calibri\" w:hAnsi=\"Calibri\" w:eastAsia=\"Microsoft YaHei\"/><w:sz w:val=\"22\"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\"><w:name w:val=\"Normal\"/></w:style><w:style w:type=\"paragraph\" w:styleId=\"Title\"><w:name w:val=\"Title\"/><w:rPr><w:b/><w:sz w:val=\"36\"/></w:rPr></w:style></w:styles>"
            ),
        ),
        (
            "word/document.xml".into(),
            format!(
                "<w:document xmlns:w=\"{W}\"><w:body>{body}<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1440\" w:right=\"1273\" w:bottom=\"1440\" w:left=\"1273\"/></w:sectPr></w:body></w:document>"
            ),
        ),
    ])
}

fn shape(id: u32, name: &str, texts: &[&str], y: u32, height: u32, title: bool) -> Result<String> {
    let mut paragraphs = String::new();
    for s in texts {
        paragraphs.push_str(&format!("<a:p><a:r><a:rPr lang=\"zh-CN\" sz=\"{}\"/><a:t>{}</a:t></a:r><a:endParaRPr lang=\"zh-CN\"/></a:p>",if title{3200}else{2200},escape(s)?));
    }
    Ok(format!(
        "<p:sp><p:nvSpPr><p:cNvPr id=\"{id}\" name=\"{name}\"/><p:cNvSpPr txBox=\"1\"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x=\"685800\" y=\"{y}\"/><a:ext cx=\"10820400\" cy=\"{height}\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap=\"square\"/><a:lstStyle/>{paragraphs}</p:txBody></p:sp>"
    ))
}
fn group() -> String {
    "<p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>".into()
}
fn pptx(document: &Value) -> Result<Vec<u8>> {
    keys(document, &["slides"])?;
    let slides = document["slides"]
        .as_array()
        .context("office_expected_slides")?;
    ensure!(
        !slides.is_empty() && slides.len() <= 30,
        "office_slide_limit"
    );
    let mut parts = Vec::new();
    let mut ids = String::new();
    let mut overrides = String::new();
    let mut relationships = String::new();
    for (i, slide) in slides.iter().enumerate() {
        keys(slide, &["title", "paragraphs"])?;
        let title = text(&slide["title"])?;
        ensure!(title.chars().count() <= 50, "office_slide_title_limit");
        let lines = slide["paragraphs"]
            .as_array()
            .context("office_expected_paragraphs")?;
        ensure!(lines.len() <= 8, "office_slide_paragraph_limit");
        let lines: Vec<_> = lines.iter().map(text).collect::<Result<_>>()?;
        ensure!(
            lines.iter().all(|s| s.chars().count() <= 180),
            "office_slide_text_limit"
        );
        let wrapped_lines: usize = lines
            .iter()
            .flat_map(|s| s.split('\n'))
            .map(|s| s.chars().count().div_ceil(40).max(1))
            .sum();
        ensure!(
            wrapped_lines <= 12,
            "office_slide_text_overflow_split_into_more_slides"
        );
        let n = i + 1;
        ids.push_str(&format!("<p:sldId id=\"{}\" r:id=\"rId{n}\"/>", 256 + i));
        relationships.push_str(&format!(
            "<Relationship Id=\"rId{n}\" Type=\"{OFFICE}/slide\" Target=\"slides/slide{n}.xml\"/>"
        ));
        overrides.push_str(&format!("<Override PartName=\"/ppt/slides/slide{n}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slide+xml\"/>"));
        parts.push((format!("ppt/slides/slide{n}.xml"),format!("<p:sld xmlns:p=\"{P}\" xmlns:a=\"{A}\" xmlns:r=\"{OFFICE}\"><p:cSld><p:spTree>{}{}{}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>",group(),shape(2,"Title",&[title],457200,1143000,true)?,shape(3,"Content",&lines,1600200,4572000,false)?)));
        parts.push((format!("ppt/slides/_rels/slide{n}.xml.rels"),format!("<Relationships xmlns=\"{RELS}\"><Relationship Id=\"rIdLayout\" Type=\"{OFFICE}/slideLayout\" Target=\"../slideLayouts/slideLayout1.xml\"/></Relationships>")));
    }
    parts.extend([
        ("[Content_Types].xml".into(),format!("<Types xmlns=\"{CONTENT}\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/ppt/presentation.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml\"/><Override PartName=\"/ppt/slideMasters/slideMaster1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml\"/><Override PartName=\"/ppt/slideLayouts/slideLayout1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml\"/><Override PartName=\"/ppt/theme/theme1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.theme+xml\"/>{overrides}</Types>")),
        ("_rels/.rels".into(),format!("<Relationships xmlns=\"{RELS}\"><Relationship Id=\"rId1\" Type=\"{OFFICE}/officeDocument\" Target=\"ppt/presentation.xml\"/></Relationships>")),
        ("ppt/presentation.xml".into(),format!("<p:presentation xmlns:p=\"{P}\" xmlns:a=\"{A}\" xmlns:r=\"{OFFICE}\"><p:sldMasterIdLst><p:sldMasterId id=\"2147483648\" r:id=\"rIdMaster\"/></p:sldMasterIdLst><p:sldIdLst>{ids}</p:sldIdLst><p:sldSz cx=\"12192000\" cy=\"6858000\"/><p:notesSz cx=\"6858000\" cy=\"9144000\"/></p:presentation>")),
        ("ppt/_rels/presentation.xml.rels".into(),format!("<Relationships xmlns=\"{RELS}\">{relationships}<Relationship Id=\"rIdMaster\" Type=\"{OFFICE}/slideMaster\" Target=\"slideMasters/slideMaster1.xml\"/></Relationships>")),
        ("ppt/slideMasters/slideMaster1.xml".into(),format!("<p:sldMaster xmlns:p=\"{P}\" xmlns:a=\"{A}\" xmlns:r=\"{OFFICE}\"><p:cSld><p:spTree>{}</p:spTree></p:cSld><p:clrMap accent1=\"accent1\" accent2=\"accent2\" accent3=\"accent3\" accent4=\"accent4\" accent5=\"accent5\" accent6=\"accent6\" bg1=\"lt1\" bg2=\"lt2\" folHlink=\"folHlink\" hlink=\"hlink\" tx1=\"dk1\" tx2=\"dk2\"/><p:sldLayoutIdLst><p:sldLayoutId id=\"2147483649\" r:id=\"rIdLayout\"/></p:sldLayoutIdLst><p:txStyles/></p:sldMaster>",group())),
        ("ppt/slideMasters/_rels/slideMaster1.xml.rels".into(),format!("<Relationships xmlns=\"{RELS}\"><Relationship Id=\"rIdLayout\" Type=\"{OFFICE}/slideLayout\" Target=\"../slideLayouts/slideLayout1.xml\"/><Relationship Id=\"rIdTheme\" Type=\"{OFFICE}/theme\" Target=\"../theme/theme1.xml\"/></Relationships>")),
        ("ppt/slideLayouts/slideLayout1.xml".into(),format!("<p:sldLayout xmlns:p=\"{P}\" xmlns:a=\"{A}\" xmlns:r=\"{OFFICE}\" type=\"blank\" preserve=\"1\"><p:cSld name=\"Blank\"><p:spTree>{}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>",group())),
        ("ppt/slideLayouts/_rels/slideLayout1.xml.rels".into(),format!("<Relationships xmlns=\"{RELS}\"><Relationship Id=\"rIdMaster\" Type=\"{OFFICE}/slideMaster\" Target=\"../slideMasters/slideMaster1.xml\"/></Relationships>"))
    ]);
    parts.push(("ppt/theme/theme1.xml".into(), theme()));
    zip(parts)
}

fn theme() -> String {
    let colors = [
        ("dk1", "222222"),
        ("lt1", "FFFFFF"),
        ("dk2", "1D2330"),
        ("lt2", "E2E3E5"),
        ("accent1", "4472C4"),
        ("accent2", "ED7D31"),
        ("accent3", "A5A5A5"),
        ("accent4", "FFC000"),
        ("accent5", "5B9BD5"),
        ("accent6", "70AD47"),
        ("hlink", "0563C1"),
        ("folHlink", "954F72"),
    ]
    .into_iter()
    .map(|(k, v)| format!("<a:{k}><a:srgbClr val=\"{v}\"/></a:{k}>"))
    .collect::<String>();
    let fonts=["majorFont","minorFont"].into_iter().map(|kind|format!("<a:{kind}><a:latin typeface=\"Calibri\"/><a:ea typeface=\"Microsoft YaHei\"/><a:cs typeface=\"Arial\"/></a:{kind}>")).collect::<String>();
    let fills = "<a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill>".repeat(3);
    let lines="<a:ln w=\"12700\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:prstDash val=\"solid\"/></a:ln>".repeat(3);
    let effects = "<a:effectStyle><a:effectLst/></a:effectStyle>".repeat(3);
    format!(
        "<a:theme xmlns:a=\"{A}\" name=\"AgentV2\"><a:themeElements><a:clrScheme name=\"AgentV2\">{colors}</a:clrScheme><a:fontScheme name=\"AgentV2\">{fonts}</a:fontScheme><a:fmtScheme name=\"AgentV2\"><a:fillStyleLst>{fills}</a:fillStyleLst><a:lnStyleLst>{lines}</a:lnStyleLst><a:effectStyleLst>{effects}</a:effectStyleLst><a:bgFillStyleLst>{fills}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>"
    )
}
