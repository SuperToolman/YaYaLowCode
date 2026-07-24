Location catalog format

The importable catalog is locations.json. It is a flat, parent-before-child
array with this shape:

  { "code": "JP", "parentCode": null, "kind": "country", "name": "日本",
    "labels": { "zh-CN": "日本", "ja-JP": "日本", "en-US": "Japan" } }
  { "code": "JP-13", "parentCode": "JP", "kind": "prefecture", "name": "東京都",
    "labels": { "zh-CN": "东京都", "ja-JP": "東京都", "en-US": "Tokyo" } }
  { "code": "JP-13-13101", "parentCode": "JP-13", "kind": "municipality", "name": "千代田区",
    "labels": { "zh-CN": "千代田区", "ja-JP": "千代田区", "en-US": "Chiyoda" } }

The backend derives depth from parentCode; do not supply it. name is always the
canonical local/original name and labels holds display translations.

Run `pnpm data:location-catalog:import` from web to use the backend maintenance
CLI and its configured database connection. This does not call the HTTP API and
does not require a platform administrator account.

The legacy countries.json and cities directory are retained only as source
artifacts. They are not a valid administrative tree and must not be used to
claim a complete country/region/city catalog.

Generation sources

The generator validates both GeoNames ZIP archives before it writes locations.json.
The required archive entries are cities500.txt and alternateNamesV2.txt. A partial
download is rejected so it cannot be imported by mistake.

For an offline or mirrored source, set these environment variables to complete
local files before running pnpm data:location-catalog:

  LOCATION_CATALOG_GEONAMES_CITIES_PATH=<path to cities500.zip>
  LOCATION_CATALOG_GEONAMES_ALTERNATE_NAMES_PATH=<path to alternateNamesV2.zip>

You may also set LOCATION_CATALOG_SOURCE_DIR to a directory containing
countries-native.json and countries-zh.json. Do not run the import command
until generation has completed and locations.json is present.
