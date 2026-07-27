---
name: bom-quote
description: "Create BOM quotation workbooks from Excel BOM files, query supplier websites including LCSC/立创商城 and ICKEY for Vision_name-based electronic component pricing, compare stock, MOQ, lead time, and price by business priority, and generate Excel quote sheets. Use when the user asks for BOM询价/报价, electronic component supplier lookup, website-specific supplier API querying, or quotation workbook generation from columns like Vision_name, Qty, and Purchase_Quantity."
---

# BOM Quote

## Overview

Use this skill to turn a customer BOM workbook into a supplier-backed quotation workbook. The expected source is an Excel BOM sheet with `Vision_name`, `Qty`, and `Purchase_Quantity`; when `Purchase_Quantity` is not present, request or infer the quotation set quantity before building the quote.

## Workflow

1. Identify the source BOM sheet. Prefer a sheet named `原始bom`; otherwise use the first worksheet that contains `Vision_name` and `Qty`.
2. Normalize each BOM row:
   - `Vision_name`: original material description.
   - `Qty`: per-set usage.
   - `Purchase_Quantity`: quote set count or purchasing batch count.
   - `total_quantity = Qty * Purchase_Quantity`.
   - `search_keyword`: text after the first `:` or `：`; if no colon exists, use the full `Vision_name`.
3. Generate the query list:
   ```bash
   python scripts/bom_quote.py prepare --bom INPUT.xlsx --purchase-quantity 3000 --out queries.json
   ```
4. Query configured supplier sites. Read `references/query-sites.md` before querying.
   - For LCSC/立创商城, use:
     ```bash
     python scripts/bom_quote.py query-lcsc --queries queries.json --out lcsc-offers.json
     ```
   - Record other supplier results in the JSON format from `references/results-schema.md`.
5. Build the quotation workbook:
   ```bash
   python scripts/bom_quote.py build --bom INPUT.xlsx --results offers.json --append-sheet
   ```
   This adds or replaces sheet `整理后的报价` inside the source workbook. If the source workbook cannot be saved, pass `--out FALLBACK.xlsx` so the script can save a copy.
6. Verify the output workbook:
   - Every BOM row has a row in the quotation sheet.
   - Main selected offer follows the ranking rules below.
   - Each supplier group contains URL, price, stock, MOQ, and lead time.
   - Missing, uncertain, substitute, non-stock, or API-blocked results are explained in `备注` or the results JSON.

## Supplier Ranking

Apply this ranking per website first, then apply the same ranking across the chosen website results to populate the main quote columns:

1. Prefer offers that are in stock or clearly marked `现货`.
2. Prefer offers where `库存数量 >= total_quantity`.
3. Prefer offers where `total_quantity >= MOQ`.
4. Only after those checks, prefer the lowest numeric unit price.

Treat unknown values conservatively: unknown stock loses to known sufficient stock, unknown MOQ loses to MOQ satisfied, and unknown price loses to known price. Do not pick a cheaper item if it fails a higher-priority condition that another item satisfies.

## Output Workbook

The generated quotation sheet must use a two-row header. Main columns are merged vertically; supplier result columns use the supplier name as the first-level header and these second-level columns:

- `网址`
- `命中后的bom的店铺链接`
- `查价格`
- `库存数量`
- `MOQ（最小起订量）`
- `查交期`

Main output columns:

- `序号`
- `物料名称`
- `制造商`
- `制造商型号`
- `规格参数`
- `位号`
- `用量`
- `单位`
- quote quantity unit price, such as `3000套单价` or `采购数量单价`
- `下单数量（采购数量）`
- quote quantity total, such as `3000套总价` or `采购数量总价`
- `备注`
- `交期`

Keep `位号` blank unless the user explicitly asks to copy the original BOM `Part` column.

## Resources

- `scripts/bom_quote.py`: prepares query JSON, queries LCSC, ranks offers, and builds or appends quotation sheets.
- `references/query-sites.md`: supplier website query rules and known query APIs.
- `references/results-schema.md`: JSON schema for recording supplier search results.

Ask the user for the missing supplier URLs/names if fewer than four websites are configured or provided. Do not invent supplier data.
