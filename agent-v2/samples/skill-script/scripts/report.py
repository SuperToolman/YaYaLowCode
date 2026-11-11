import csv
import os
from pathlib import Path

template = Path(os.environ["YAYA_SKILL_DIR"]) / "templates/report.csv"
target = Path(os.environ["YAYA_OUTPUT_DIR"]) / "report.csv"
with template.open(encoding="utf-8", newline="") as source:
    rows = list(csv.reader(source))
rows.append(["example", "42"])
with target.open("w", encoding="utf-8-sig", newline="") as output:
    csv.writer(output).writerows(rows)
print("Report generated")
