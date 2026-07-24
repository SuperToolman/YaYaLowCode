import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(scriptDirectory, "../public/location-catalog");
const cacheDirectory = resolve(scriptDirectory, "../.cache/location-catalog");

const sources = {
  countries: "https://raw.githubusercontent.com/mledoze/countries/master/dist/countries.json",
  chineseNames: "https://raw.githubusercontent.com/michaelwittig/node-i18n-iso-countries/master/langs/zh.json",
  cities: "https://download.geonames.org/export/dump/cities500.zip",
  admin1: "https://download.geonames.org/export/dump/admin1CodesASCII.txt",
  admin2: "https://download.geonames.org/export/dump/admin2Codes.txt",
  alternateNames: "https://download.geonames.org/export/dump/alternateNamesV2.zip",
};

const sourceDirectory = process.env.LOCATION_CATALOG_SOURCE_DIR;
const citiesArchive = await sourceFile("cities500.zip", sources.cities, "LOCATION_CATALOG_GEONAMES_CITIES_PATH");
await assertCatalogSource(citiesArchive, "cities500.txt");
const admin1File = await sourceFile("admin1CodesASCII.txt", sources.admin1, "LOCATION_CATALOG_GEONAMES_ADMIN1_PATH");
await assertCatalogSource(admin1File, "admin1CodesASCII.txt");
const admin2File = await sourceFile("admin2Codes.txt", sources.admin2, "LOCATION_CATALOG_GEONAMES_ADMIN2_PATH");
await assertCatalogSource(admin2File, "admin2Codes.txt");
const alternateNamesArchive = await sourceFile(
  "alternateNamesV2.zip",
  sources.alternateNames,
  "LOCATION_CATALOG_GEONAMES_ALTERNATE_NAMES_PATH",
);
await assertCatalogSource(alternateNamesArchive, "alternateNamesV2.txt");
const countries = await loadCountries();

const cities = await readCities(citiesArchive);
const regions = await readRegions(admin1File);
const districts = await readDistricts(admin2File);
await applyAlternateNames(new Map([
  ...cities,
  ...[...regions.values()].map((region) => [region.geonamesId, region]),
  ...[...districts.values()].map((district) => [district.geonamesId, district]),
]), alternateNamesArchive);
applyOverrides(cities, await loadOverrides());
const catalog = buildCatalog(countries, regions, districts, cities);
await writeCatalog(catalog);
await writeReport(catalog);

async function loadJson(fileName, url) {
  if (sourceDirectory) {
    try {
      return JSON.parse(await readFile(resolve(sourceDirectory, fileName), "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to download ${url}: ${response.status}`);
  return response.json();
}

async function loadCountries() {
  try {
    const [rawCountries, chineseNames] = await Promise.all([
      loadJson("countries-native.json", sources.countries),
      loadJson("countries-zh.json", sources.chineseNames),
    ]);
    return rawCountries
      .filter((country) => country.cca2)
      .map((country) => {
        const native = firstNativeName(country) ?? country.name.common;
        const english = country.name.common;
        const chinese = chineseNames.countries?.[country.cca2] ?? english;
        return {
          code: country.cca2,
          name: native,
          originalName: native,
          labels: {
            "zh-CN": chinese,
            "en-US": english,
            "ja-JP": country.translations?.jpn?.common ?? native,
          },
          source: "mledoze-countries",
          sourceId: country.cca3 ?? country.cca2,
        };
      })
      .sort((left, right) => left.labels["zh-CN"].localeCompare(right.labels["zh-CN"], "zh-CN"));
  } catch (error) {
    console.warn(`Country source download failed; using the checked-in country seed: ${error.message}`);
    return loadLegacyCountries();
  }
}

async function loadLegacyCountries() {
  const legacy = JSON.parse(await readFile(resolve(outputDirectory, "countries.json"), "utf8"));
  const englishNames = new Intl.DisplayNames(["en-US"], { type: "region" });
  const japaneseNames = new Intl.DisplayNames(["ja-JP"], { type: "region" });
  return legacy
    .filter((country) => typeof country.code === "string" && country.code.length === 2)
    .map((country) => {
      const native = country.originalName?.trim() || country.name.trim();
      return {
        code: country.code,
        name: native,
        originalName: native,
        labels: {
          "zh-CN": country.name.trim(),
          "en-US": englishNames.of(country.code) ?? native,
          "ja-JP": japaneseNames.of(country.code) ?? native,
        },
        source: "legacy-country-seed",
        sourceId: country.code,
      };
    })
    .sort((left, right) => left.labels["zh-CN"].localeCompare(right.labels["zh-CN"], "zh-CN"));
}

async function sourceFile(fileName, url, environmentVariable) {
  const configuredPath = process.env[environmentVariable];
  if (configuredPath) return configuredPath;
  await mkdir(cacheDirectory, { recursive: true });
  const path = resolve(cacheDirectory, fileName);
  try {
    await readFile(path);
    return path;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Unable to download ${url}: ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(path));
  return path;
}

async function assertCatalogSource(archivePath, entryName) {
  if (!archivePath.toLowerCase().endsWith(".zip")) {
    const details = await stat(archivePath);
    if (!details.isFile() || details.size === 0) {
      throw new Error(`Invalid ${entryName} source at ${archivePath}.`);
    }
    return;
  }
  const result = await new Promise((resolve, reject) => {
    const process = spawn("tar", ["-tf", archivePath, entryName], { stdio: ["ignore", "ignore", "pipe"] });
    const errors = [];
    process.stderr.on("data", (chunk) => errors.push(chunk));
    process.once("error", reject);
    process.once("close", (code) => resolve({ code, errors: Buffer.concat(errors).toString().trim() }));
  });
  if (result.code !== 0) {
    throw new Error(`Invalid ${entryName} archive at ${archivePath}. Provide a complete archive through the matching LOCATION_CATALOG_GEONAMES_*_PATH variable. ${result.errors}`);
  }
}

async function readCities(archivePath) {
  const cities = new Map();
  for await (const line of zipText(archivePath, "cities500.txt")) {
    const columns = line.split("\t");
    if (columns.length < 19 || columns[6] !== "P" || !columns[8]) continue;
    const [id, name, asciiName] = columns;
    const countryCode = columns[8];
    const admin1Code = columns[10];
    const admin2Code = columns[11];
    const population = columns[14];
    cities.set(id, {
      id,
      countryCode,
      name,
      asciiName: asciiName || name,
      admin1Code,
      admin2Code,
      population: Number(population) || 0,
      alternatives: new Map(),
    });
  }
  return cities;
}

async function readRegions(filePath) {
  const regions = new Map();
  for await (const line of catalogText(filePath, "admin1CodesASCII.txt")) {
    const [code, name, asciiName, geonamesId] = line.split("\t");
    const [countryCode, admin1Code] = code?.split(".") ?? [];
    if (!countryCode || !admin1Code || !name || !geonamesId) continue;
    regions.set(code, {
      id: `admin1:${code}`,
      countryCode,
      admin1Code,
      name,
      asciiName: asciiName || name,
      geonamesId,
      alternatives: new Map(),
    });
  }
  return regions;
}

async function readDistricts(filePath) {
  const districts = new Map();
  for await (const line of catalogText(filePath, "admin2Codes.txt")) {
    const [code, name, asciiName, geonamesId] = line.split("\t");
    const [countryCode, admin1Code, ...admin2Segments] = code?.split(".") ?? [];
    const admin2Code = admin2Segments.join(".");
    if (!countryCode || !admin1Code || !admin2Code || !name || !geonamesId) continue;
    districts.set(code, {
      code,
      countryCode,
      admin1Code,
      admin2Code,
      name,
      asciiName: asciiName || name,
      geonamesId,
      alternatives: new Map(),
    });
  }
  return districts;
}

async function applyAlternateNames(cities, archivePath) {
  for await (const line of catalogText(archivePath, "alternateNamesV2.txt")) {
    const columns = line.split("\t");
    const city = cities.get(columns[1]);
    if (!city || columns.length < 5) continue;
    const sourceLanguage = columns[2];
    const language = normalizeLanguage(sourceLanguage);
    const value = columns[3]?.trim();
    if (!language || !value) continue;
    const previous = city.alternatives.get(language);
    const preferred = columns[4] === "1";
    const priority = languagePriority(sourceLanguage);
    if (!previous || priority > previous.priority || (priority === previous.priority && preferred && !previous.preferred)) {
      city.alternatives.set(language, { value, preferred, priority });
    }
  }
}

function applyOverrides(cities, overrides) {
  for (const [id, labels] of Object.entries(overrides)) {
    const city = cities.get(id);
    if (!city) throw new Error(`Location override references unknown GeoNames ID: ${id}`);
    for (const [language, value] of Object.entries(labels)) {
      if (typeof value === "string" && value.trim()) city.alternatives.set(language, { value: value.trim(), preferred: true });
    }
  }
}

async function loadOverrides() {
  try {
    return JSON.parse(await readFile(resolve(scriptDirectory, "location-catalog-overrides.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

function buildCatalog(countries, regions, districts, cities) {
  const knownCountries = new Set(countries.map((country) => country.code));
  const locations = countries.map((country, sortOrder) => ({
    code: country.code,
    parentCode: null,
    kind: "country",
    name: country.originalName ?? country.name,
    labels: country.labels,
    source: country.source,
    sourceId: country.sourceId,
    sortOrder,
  }));
  const regionGroups = new Map(countries.map((country) => [country.code, []]));
  const regionCodeByAdmin1 = new Map();
  for (const region of regions.values()) {
    if (!knownCountries.has(region.countryCode)) continue;
    const japanese = region.alternatives.get("ja-JP")?.value;
    const chinese = region.alternatives.get("zh-CN")?.value;
    const english = region.alternatives.get("en-US")?.value ?? region.asciiName;
    const code = `geonames:admin1:${region.countryCode}.${region.admin1Code}`;
    regionCodeByAdmin1.set(`${region.countryCode}.${region.admin1Code}`, code);
    regionGroups.get(region.countryCode).push({
      code,
      parentCode: region.countryCode,
      kind: "region",
      name: region.name,
      labels: {
        "zh-CN": chinese ?? region.name,
        "en-US": english,
        "ja-JP": japanese ?? region.name,
      },
      source: "geonames",
      sourceId: region.geonamesId,
    });
  }
  const districtGroups = new Map();
  const districtCodeByAdmin2 = new Map();
  for (const district of districts.values()) {
    const parentCode = regionCodeByAdmin1.get(`${district.countryCode}.${district.admin1Code}`);
    if (!parentCode) continue;
    const code = `geonames:admin2:${district.code}`;
    districtCodeByAdmin2.set(`${district.countryCode}.${district.admin1Code}.${district.admin2Code}`, code);
    const japanese = district.alternatives.get("ja-JP")?.value;
    const chinese = district.alternatives.get("zh-CN")?.value;
    const english = district.alternatives.get("en-US")?.value ?? district.asciiName;
    const group = districtGroups.get(parentCode) ?? [];
    group.push({
      code,
      parentCode,
      kind: "district",
      name: district.name,
      labels: {
        "zh-CN": chinese ?? district.name,
        "en-US": english,
        "ja-JP": japanese ?? district.name,
      },
      source: "geonames",
      sourceId: district.geonamesId,
    });
    districtGroups.set(parentCode, group);
  }
  const cityGroups = new Map(countries.map((country) => [country.code, []]));
  for (const city of cities.values()) {
    if (!knownCountries.has(city.countryCode)) continue;
    const japanese = city.alternatives.get("ja-JP")?.value;
    const chinese = city.alternatives.get("zh-CN")?.value;
    const english = city.alternatives.get("en-US")?.value ?? city.asciiName;
    const nativeName = city.countryCode === "JP" && japanese ? japanese : city.name;
    cityGroups.get(city.countryCode).push({
      code: `geonames:${city.id}`,
      parentCode: districtCodeByAdmin2.get(`${city.countryCode}.${city.admin1Code}.${city.admin2Code}`)
        ?? regionCodeByAdmin1.get(`${city.countryCode}.${city.admin1Code}`)
        ?? city.countryCode,
      kind: "city",
      name: nativeName,
      labels: {
        "zh-CN": chinese ?? city.name,
        "en-US": english,
        "ja-JP": japanese ?? city.name,
      },
      source: "geonames",
      sourceId: city.id,
      population: city.population,
      admin1Code: city.admin1Code,
    });
  }
  for (const group of cityGroups.values()) {
    group.sort((left, right) => right.population - left.population || left.name.localeCompare(right.name));
  }
  for (const country of countries) {
    const regionsForCountry = regionGroups.get(country.code);
    regionsForCountry.sort((left, right) => left.name.localeCompare(right.name));
    for (const [sortOrder, region] of regionsForCountry.entries()) {
      locations.push({ ...region, sortOrder });
      const districtsForRegion = districtGroups.get(region.code) ?? [];
      districtsForRegion.sort((left, right) => left.name.localeCompare(right.name));
      for (const [districtSortOrder, district] of districtsForRegion.entries()) {
        locations.push({ ...district, sortOrder: districtSortOrder });
      }
    }
    const citiesForCountry = cityGroups.get(country.code);
    for (const [sortOrder, city] of citiesForCountry.entries()) {
      locations.push({ ...city, sortOrder });
    }
  }
  return { countries, regionGroups, districtGroups, cityGroups, locations };
}

async function writeCatalog({ locations }) {
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(resolve(outputDirectory, "locations.json"), `${JSON.stringify(locations)}\n`);
}

async function writeReport({ countries, regionGroups, districtGroups, cityGroups, locations }) {
  const regions = [...regionGroups.values()].flat();
  const districts = [...districtGroups.values()].flat();
  const cities = [...cityGroups.values()].flat();
  const missing = Object.fromEntries(["zh-CN", "en-US", "ja-JP"].map((locale) => [
    locale,
    cities.filter((city) => city.labels[locale] === city.name).length,
  ]));
  const codes = new Set(cities.map((city) => city.code));
  if (codes.size !== cities.length) throw new Error("Duplicate GeoNames location IDs were generated");
  await writeFile(resolve(outputDirectory, "quality-report.json"), `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    countries: countries.length,
    regions: regions.length,
    districts: districts.length,
    cities: cities.length,
    locations: locations.length,
    duplicateCodes: 0,
    fallbackLabels: missing,
    notes: "A fallback label is intentionally not treated as a translation. Add a GeoNames alternate name or location-catalog-overrides.json to improve it.",
  }, null, 2)}\n`);
}

function firstNativeName(country) {
  return Object.values(country.name?.native ?? {})[0]?.common;
}

function normalizeLanguage(value) {
  if (value === "zh" || value === "zh-Hans" || value === "zh-CN") return "zh-CN";
  if (value === "ja") return "ja-JP";
  if (value === "ja-JP") return "ja-JP";
  if (value === "en") return "en-US";
  if (value === "en-US") return "en-US";
  return null;
}

function languagePriority(value) {
  if (value === "zh-CN" || value === "ja-JP" || value === "en-US") return 2;
  return 1;
}

async function* catalogText(sourcePath, entryName) {
  if (sourcePath.toLowerCase().endsWith(".zip")) {
    yield* zipText(sourcePath, entryName);
    return;
  }
  const lines = createInterface({ input: createReadStream(sourcePath), crlfDelay: Infinity });
  for await (const line of lines) yield line;
}

async function* zipText(archivePath, entryName) {
  const process = spawn("tar", ["-xOf", archivePath, entryName], { stdio: ["ignore", "pipe", "pipe"] });
  const errors = [];
  process.stderr.on("data", (chunk) => errors.push(chunk));
  const lines = createInterface({ input: process.stdout, crlfDelay: Infinity });
  for await (const line of lines) yield line;
  const exitCode = await new Promise((resolveProcess, reject) => {
    process.once("error", reject);
    process.once("close", resolveProcess);
  });
  if (exitCode !== 0) throw new Error(`Unable to read ${entryName} from ${archivePath}: ${Buffer.concat(errors).toString()}`);
}
