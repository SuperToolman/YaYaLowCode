use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use yaya_agent_v2_office::handle;
fn generate(name: &str, document: Value) -> Vec<u8> {
    STANDARD
        .decode(
            handle(json!({"operation":"write","name":name,"document":document})).unwrap()["data"]
                .as_str()
                .unwrap(),
        )
        .unwrap()
}
fn read(name: &str, bytes: &[u8], options: Value) -> Value {
    handle(json!({"operation":"read","name":name,"data":STANDARD.encode(bytes),"options":options}))
        .unwrap()
}

#[test]
fn preparation_samples_use_explicit_bounds_and_preserve_valid_json() {
    let rows: Vec<Value> = (0..25)
        .map(|i| json!([i, "00123", "中".repeat(2000), 4, 5, 6, 7, 8, 9]))
        .collect();
    let xlsx = generate(
        "sample.xlsx",
        json!({"sheets":[{"name":"BOM","rows":rows},{"name":"Other","rows":[["other"]]}]}),
    );
    let sample=handle(json!({"operation":"preview","name":"sample.xlsx","data":STANDARD.encode(xlsx),"options":{"start":1,"limit":10,"columns":8}})).unwrap();
    assert!(sample.to_string().len() <= 8192);
    assert_eq!(sample["sampleOnly"], true);
    assert_eq!(sample["complete"], false);
    assert!(sample["rows"].as_array().unwrap().len() <= 10);
    for row in sample["rows"].as_array().unwrap() {
        assert!(row["cells"].as_array().unwrap().len() <= 8);
    }
    assert!(
        sample["sheets"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s == "Other")
    );
    let doc = generate(
        "sample.docx",
        json!({"paragraphs":(0..20).map(|i|format!("Paragraph {i}")).collect::<Vec<_>>()}),
    );
    let sample=handle(json!({"operation":"preview","name":"sample.docx","data":STANDARD.encode(doc),"options":{"limit":10}})).unwrap();
    assert_eq!(sample["units"].as_array().unwrap().len(), 10);
    assert_eq!(sample["complete"], false);
    let ppt = generate(
        "sample.pptx",
        json!({"slides":(0..5).map(|i|json!({"title":format!("Slide {i}"),"paragraphs":["body"]})).collect::<Vec<_>>()}),
    );
    let sample=handle(json!({"operation":"preview","name":"sample.pptx","data":STANDARD.encode(ppt),"options":{"limit":3}})).unwrap();
    assert_eq!(sample["units"].as_array().unwrap().len(), 3);
    assert_eq!(sample["complete"], false);
}

#[test]
fn excel_roundtrip_types_sheets_pagination_and_formula_injection() {
    let bytes = generate(
        "物料.xlsx",
        json!({"sheets":[{"name":"BOM","header":true,"rows":[["型号","数量","启用"],["00123",42,true],["=HYPERLINK(\"https://invalid\")",null,false]]},{"name":"说明","rows":[["其它工作表"]]}]}),
    );
    let result = read(
        "物料.xlsx",
        &bytes,
        json!({"sheet":"BOM","start":2,"limit":1,"columns":2}),
    );
    assert_eq!(result["sheets"], json!(["BOM", "说明"]));
    assert_eq!(result["rows"][0]["row"], 2);
    assert_eq!(result["rows"][0]["cells"][0]["value"], "00123");
    assert_eq!(result["rows"][0]["cells"][1]["value"], 42.0);
    assert_eq!(result["nextStart"], 3);
    assert_eq!(result["nextColumn"], 3);
    assert_eq!(result["complete"], false);
    let last = read("物料.xlsx", &bytes, json!({"start":3}));
    assert!(last["rows"][0]["cells"][0]["formula"].is_null());
    assert_eq!(last["rows"][0]["cells"][0]["type"], "string");
}
#[test]
fn excel_preserves_absolute_coordinates_and_cached_formula() {
    use rust_xlsxwriter::{Formula, Workbook};
    let mut book = Workbook::new();
    let sheet = book.add_worksheet();
    sheet
        .write_formula(3, 2, Formula::new("=6*7").set_result("42"))
        .unwrap();
    let bytes = book.save_to_buffer().unwrap();
    let result = read("test.xlsx", &bytes, json!({"start":4,"column":3}));
    assert_eq!(result["rows"][0]["row"], 4);
    assert_eq!(result["rows"][0]["cells"][0]["column"], 3);
    assert_eq!(result["rows"][0]["cells"][0]["value"], 42.0);
    assert_eq!(result["rows"][0]["cells"][0]["formula"], "6*7");
}
#[test]
fn generation_is_deterministic_for_crash_replay() {
    for (name, document) in [
        (
            "test.xlsx",
            json!({"sheets":[{"name":"BOM","rows":[["中",42]]}]}),
        ),
        ("test.docx", json!({"title":"中文","paragraphs":["内容"]})),
        (
            "test.pptx",
            json!({"slides":[{"title":"中文","paragraphs":["内容"]}]}),
        ),
    ] {
        assert_eq!(generate(name, document.clone()), generate(name, document));
    }
}
#[test]
fn word_extracts_unicode_escaped_text_and_table_coordinates() {
    let bytes = generate(
        "报告.docx",
        json!({"title":"报价 <42> & 审核","paragraphs":["包含中文、空格 和 & 符号"],"tables":[{"rows":[["型号","数量"],["00123","42"]]}]}),
    );
    let result = read("报告.docx", &bytes, json!({"start":1,"limit":3}));
    assert_eq!(result["units"][0]["text"], "报价 <42> & 审核");
    assert_eq!(result["units"][2]["tableRow"], 1);
    assert_eq!(result["units"][2]["tableCell"], 1);
    assert_eq!(result["nextStart"], 4);
    assert_eq!(result["complete"], false);
}
#[test]
fn presentations_extract_in_presentation_order() {
    let bytes = generate(
        "汇报.pptx",
        json!({"slides":[{"title":"第一页","paragraphs":["测试值 42"]},{"title":"第二页","paragraphs":["第二项"]}]}),
    );
    let result = read("汇报.pptx", &bytes, json!({"start":2,"limit":1}));
    assert_eq!(result["unitCount"], 2);
    assert_eq!(result["units"][0]["slide"], 2);
    assert_eq!(result["units"][0]["paragraphs"][0]["text"], "第二页");
}
#[test]
fn csv_quotes_newlines_and_tsv_are_structured_not_split_naively() {
    let result = read(
        "test.csv",
        b"name,value\r\n\"hello, world\",\"two\nlines\"",
        json!({"start":2}),
    );
    assert_eq!(result["rowCount"], 2);
    assert_eq!(result["rows"][0]["cells"][1]["value"], "two\nlines");
    assert_eq!(read("test.tsv", b"a\tb", json!({}))["columnCount"], 2);
}

fn pdf(text: bool) -> Vec<u8> {
    let stream = if text {
        "BT /F1 18 Tf 72 700 Td (BOM 42) Tj ET"
    } else {
        ""
    };
    let objects=["<< /Type /Catalog /Pages 2 0 R >>".to_owned(),"<< /Type /Pages /Kids [3 0 R] /Count 1 >>".into(),"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>".into(),"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".into(),format!("<< /Length {} >>\nstream\n{stream}\nendstream",stream.len())];
    let mut output = "%PDF-1.4\n".to_owned();
    let mut offsets = vec![0];
    for (i, obj) in objects.iter().enumerate() {
        offsets.push(output.len());
        output.push_str(&format!("{} 0 obj\n{obj}\nendobj\n", i + 1));
    }
    let xref = output.len();
    output.push_str("xref\n0 6\n0000000000 65535 f \n");
    for offset in offsets.iter().skip(1) {
        output.push_str(&format!("{offset:010} 00000 n \n"));
    }
    output.push_str(&format!(
        "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF"
    ));
    output.into_bytes()
}
#[test]
fn pdf_text_and_image_only_page_have_explicit_outcomes() {
    let result = read("test.pdf", &pdf(true), json!({}));
    assert!(
        result["units"][0]["text"]
            .as_str()
            .unwrap()
            .contains("BOM 42")
    );
    assert_eq!(result["units"][0]["needsOcr"], false);
    assert_eq!(
        read("scanned.pdf", &pdf(false), json!({}))["units"][0]["needsOcr"],
        true
    );
}
#[test]
fn invalid_formats_pages_and_unknown_fields_are_rejected() {
    for (name, data, options) in [
        ("fake.xlsx", b"not a zip".as_slice(), json!({})),
        ("legacy.doc", b"binary", json!({})),
        ("test.pdf", b"%PDF-broken", json!({})),
    ] {
        assert!(handle(json!({"operation":"read","name":name,"data":STANDARD.encode(data),"options":options})).is_err());
    }
    for options in [
        json!({"start":0}),
        json!({"limit":201}),
        json!({"column":-1}),
        json!({"sheet":"absent"}),
    ] {
        let data = generate(
            "test.xlsx",
            json!({"sheets":[{"name":"BOM","rows":[[42]]}]}),
        );
        assert!(handle(json!({"operation":"read","name":"test.xlsx","data":STANDARD.encode(data),"options":options})).is_err());
    }
    assert!(handle(json!({"operation":"write","name":"test.xlsx","document":{"sheets":[],"shell":"whoami"}})).is_err());
    assert!(handle(json!({"operation":"write","name":"test.pdf","document":{}})).is_err());
}
