"""Optional independent-reader interoperability QA. Test fixtures only, no customer files.

Run with a Python environment providing openpyxl/python-docx/python-pptx/reportlab.
Production runtime is entirely Rust and has none of these Python dependencies.
"""
import argparse
import base64
import io
import json
from pathlib import Path
import subprocess
import zipfile

from openpyxl import Workbook, load_workbook
from docx import Document
from pptx import Presentation
from reportlab.pdfgen.canvas import Canvas

parser = argparse.ArgumentParser()
parser.add_argument("--helper", required=True)
parser.add_argument("--output", required=True)
args = parser.parse_args()
output = Path(args.output)
output.mkdir(parents=True, exist_ok=True)


def call(payload):
    result = subprocess.run([args.helper], input=json.dumps(payload).encode(),
                            capture_output=True, timeout=25, check=True)
    result = json.loads(result.stdout)
    assert "error" not in result, result
    return result["result"]


def read(name, content, options=None):
    return call(dict(operation="read", name=name,
                     data=base64.b64encode(content).decode(), options=options or {}))


def generate(name, document):
    content = base64.b64decode(call(dict(operation="write", name=name, document=document))["data"])
    (output / name).write_bytes(content)
    return content


xlsx = generate("office-acceptance.xlsx", {"sheets": [{"name": "BOM", "header": True,
    "rows": [["型号", "数量"], ["00123", 42], ['=HYPERLINK("https://invalid")', 2]]}]})
book = load_workbook(io.BytesIO(xlsx))
assert book["BOM"]["A2"].value == "00123"
assert book["BOM"]["B2"].value == 42
assert book["BOM"]["A3"].data_type == "s", "no implicit formula execution"

word = generate("office-acceptance.docx", {"title": "办公文件验收", "paragraphs": ["测试值 42"],
    "tables": [{"rows": [["型号", "数量"], ["00123", "42"]]}]})
doc = Document(io.BytesIO(word))
assert doc.paragraphs[0].text == "办公文件验收"
assert doc.tables[0].cell(1, 1).text == "42"

ppt = generate("office-acceptance.pptx", {"slides": [{"title": "办公文件验收", "paragraphs": ["测试值 42"]}]})
slides = Presentation(io.BytesIO(ppt)).slides
assert len(slides) == 1
assert any("42" in shape.text for shape in slides[0].shapes if shape.has_text_frame)

# Independent author -> Rust parser, not only Rust writer -> Rust reader round trips.
book = Workbook()
book.active.title = "材料"
book.active.append(["型号", "数量"])
book.active.append(["00001", 42])
book.create_sheet("说明").append(["第二工作表"])
buffer = io.BytesIO()
book.save(buffer)
(output / "office-input.xlsx").write_bytes(buffer.getvalue())
result = read("office-input.xlsx", buffer.getvalue(), {"sheet": "材料", "start": 2})
assert result["rows"][0]["cells"][0]["value"] == "00001"
assert result["rows"][0]["cells"][1]["value"] == 42

doc = Document()
doc.add_paragraph("来自独立 Word 库 & 测试值 42")
buffer = io.BytesIO()
doc.save(buffer)
assert "42" in json.dumps(read("independent.docx", buffer.getvalue()), ensure_ascii=False)

presentation = Presentation()
slide = presentation.slides.add_slide(presentation.slide_layouts[1])
slide.shapes.title.text = "独立 PPT 验收"
slide.placeholders[1].text = "测试值 42"
buffer = io.BytesIO()
presentation.save(buffer)
assert "42" in json.dumps(read("independent.pptx", buffer.getvalue()), ensure_ascii=False)

buffer = io.BytesIO()
canvas = Canvas(buffer)
canvas.drawString(72, 700, "Office acceptance 42")
canvas.showPage()
canvas.drawString(72, 700, "Second page 43")
canvas.save()
(output / "office-input.pdf").write_bytes(buffer.getvalue())
result = read("independent.pdf", buffer.getvalue(), {"start": 2, "limit": 1})
assert result["unitCount"] == 2 and "43" in result["units"][0]["text"]

# ODS is a standard ZIP/XML document; no external suite or proprietary service required.
buffer = io.BytesIO()
with zipfile.ZipFile(buffer, "w") as archive:
    archive.writestr("mimetype", "application/vnd.oasis.opendocument.spreadsheet")
    archive.writestr("META-INF/manifest.xml", '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>')
    archive.writestr("content.xml", '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:spreadsheet><table:table table:name="BOM"><table:table-row><table:table-cell office:value-type="string"><text:p>00123</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="42"><text:p>42</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>')
result = read("independent.ods", buffer.getvalue())
assert result["rows"][0]["cells"][1]["value"] == 42
print("PASS: independent XLSX/DOCX/PPTX readers, independent XLSX/DOCX/PPTX/PDF/ODS sources, Unicode, typed values, pagination, and formula-injection prevention")
