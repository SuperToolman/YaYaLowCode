# Supplier Results JSON Schema

Use this JSON file as the bridge between supplier research and workbook generation.

```json
{
  "sites": ["立创商城", "ICKEY", "Website3", "Website4"],
  "items": [
    {
      "source_row": 4,
      "vision_name": "Odpor SMD : 0R , 0.1W, 5%, 200ppm, vel.0603",
      "offers": [
        {
          "site": "立创商城",
          "url": "https://so.szlcsc.com/global.html?k=Odpor+SMD+...",
          "matched_url": "https://item.szlcsc.com/104411.html",
          "unit_price": 0.0061,
          "stock_qty": 3137,
          "moq": 1,
          "lead_time": "现货",
          "manufacturer": "RALEC(旺诠)",
          "manufacturer_part_number": "RTT03000JTP",
          "material_name": "贴片电阻",
          "spec": "厚膜电阻 0Ω ±5% 100mW, 0603, RTT03000JTP",
          "unit": "个",
          "in_stock": true,
          "remark": "LCSC C103196; 包装数量 5000"
        }
      ]
    }
  ]
}
```

## Matching Rules

Prefer `source_row` because it is stable even when two BOM rows share the same `Vision_name`. If `source_row` is missing, `scripts/bom_quote.py build` falls back to exact `vision_name` matching.

## Offer Rules

- `site` should match a value in `sites`.
- `url` should be the supplier search/query URL; `matched_url` should be the hit product or shop detail URL when available.
- `unit_price`, `stock_qty`, and `moq` may be numbers or strings copied from the website; the script parses common currency and comma formats.
- Use `in_stock: true` only when the website clearly indicates stock/现货 or stock quantity is positive.
- Put warnings such as partial match, substitute, price break ambiguity, login/account price limitation, or API blocking in `remark`.
