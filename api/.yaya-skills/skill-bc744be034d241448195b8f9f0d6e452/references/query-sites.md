# Supplier Website Query Rules

## Shared Query Keyword Rule

Use `search_keyword` from `scripts/bom_quote.py prepare` for generic supplier search. It is derived from `Vision_name` by taking the text after the first `:` or `：`.

For site-specific adapters, follow the site section below when it overrides this shared rule.

## Required Offer Fields

For each plausible offer, capture:

- website name
- source URL
- unit price at `total_quantity`
- stock quantity
- MOQ
- lead time
- manufacturer
- manufacturer part number
- whether the page or API indicates stock/现货
- uncertainty, substitution, price-break, or access notes

## LCSC / 立创商城

- Website name in JSON: `立创商城`
- Search homepage: `https://so.szlcsc.com/`
- API endpoint: `https://so.szlcsc.com/query/product`
- Default query keyword: full `Vision_name`, not only the text after the colon.
- Use `scripts/bom_quote.py query-lcsc` when possible.

Request flow:

1. Create a browser-like cookie session by opening `https://so.szlcsc.com/`.
2. POST JSON to `https://so.szlcsc.com/query/product`.
3. Query page 1 first. If page 1 produces no product records/offers, continue to later pages up to the configured `--max-pages`.
4. If the full `Vision_name` has no offers and `--fallback-spec` is enabled, retry with `search_keyword`.

Payload shape:

```json
{
  "currentPage": 1,
  "pageSize": 30,
  "catalogIdFilter": "",
  "brandIdFilter": "",
  "standardFilter": "",
  "arrangeFilter": "",
  "labelFilter": "",
  "authenticationFilter": "",
  "keyword": "Odpor SMD : 0R , 0.1W, 5%, 200ppm, vel.0603",
  "sortNumber": 0,
  "satisfyStockType": "",
  "startPrice": "",
  "endPrice": "",
  "demandNumber": "",
  "spotFilter": 1,
  "discountFilter": 1,
  "hasDataFile": false,
  "brandPlaceFilter": "",
  "secondKeyword": "",
  "queryParameterValue": "",
  "lastParamName": ""
}
```

Field mapping:

- manufacturer: `productVO.productGradePlateName`
- manufacturer part number: `productVO.productModel`
- material name: `productVO.productType`, fallback `productVO.productName`
- spec: combine `productVO.productName`, `productVO.encapsulationModel`, and `productVO.productModel`
- stock quantity: prefer `productVO.stockNumber`; fallback to `totalStockNumber`, `validStockNumber`, warehouse fields
- MOQ: prefer `productVO.minBuyNumber`; fallback to `productVO.productMinEncapsulationNumber`
- price: choose the `productPriceList` bracket matching `total_quantity`; fallback to the lowest parsed price
- lead time: `现货` when `hasStockNow` or `productStockStatus` is `yes`; otherwise use delivery days/weeks when present
- source URL: use the query URL used for this keyword
- matched URL: use the product detail URL or product-code search URL for the matched BOM result

If the API returns 403 from a direct POST, retry with the script's cookie-session flow. If the site still blocks automation, use browser search and record the visible results manually in `results-schema.md` format.

## ICKEY / 搜芯易

- Website name in JSON: `ICKEY`
- Query URL template:
  `https://search.ickey.cn/?keyword={urlencoded_search_keyword}&bom_ab=null`

When using this site in a browser, search with `search_keyword`, inspect result rows, and capture the best candidates rather than only the top row. Some pages may load dynamically; use the visible result table and product detail page URL as the source URL.

## Other Supplier Websites

Before a live quote, ask for the remaining supplier sites:

- supplier display name for the workbook group header
- search URL, API endpoint, or homepage
- whether login, account pricing, captcha, or internal access is required
- whether substitute parts are allowed

If the user supplies a site without an API or search URL template, use the site's own search box in the browser and record the final visible result URL.
