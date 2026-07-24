import { listLocations, type LocationResponse } from "./api-client";

export type LocationCatalogItem = LocationResponse;

export type LocationPathValue = {
  code: string;
  depth: number;
  path: LocationCatalogItem[];
};

// Kept as an exported alias while older form schemas still call this field countryCity.
export type CountryCityValue = LocationPathValue;

type LegacyCountryCityValue = {
  国家: LocationCatalogItem | null;
  城市: LocationCatalogItem | null;
};

const catalogCache = new Map<string, Promise<LocationCatalogItem[]>>();

export function createEmptyCountryCityValue(): CountryCityValue {
  return { code: "", depth: 0, path: [] };
}

export function isCountryCityValue(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<LocationPathValue>;
  return (typeof candidate.code === "string"
    && typeof candidate.depth === "number"
    && Array.isArray(candidate.path)
    && candidate.path.every(isLocationCatalogItem))
    || isLegacyCountryCityValue(value);
}

export function normalizeCountryCityValue(value: unknown): CountryCityValue {
  if (isNewCountryCityValue(value)) {
    return {
      code: value.code,
      depth: value.depth,
      path: value.path.map(toStoredLocationItem),
    };
  }

  // Records created before the tree model used two fixed fields. Convert them on read.
  if (isLegacyCountryCityValue(value)) {
    const path = [value.国家, value.城市].filter(isLocationCatalogItem).map(toStoredLocationItem);
    const selected = path.at(-1);
    return selected
      ? { code: selected.code, depth: selected.depth || path.length, path }
      : createEmptyCountryCityValue();
  }
  return createEmptyCountryCityValue();
}

function isNewCountryCityValue(value: unknown): value is CountryCityValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<LocationPathValue>;
  return typeof candidate.code === "string"
    && typeof candidate.depth === "number"
    && Array.isArray(candidate.path)
    && candidate.path.every(isLocationCatalogItem);
}

export function getRuntimeLocale() {
  return typeof navigator === "undefined" ? "zh-CN" : navigator.language || "zh-CN";
}

export function getLocationLabel(item: LocationCatalogItem, locale = getRuntimeLocale()) {
  const labels = item.labels ?? {};
  const normalizedLocale = locale.replace("_", "-");
  const language = normalizedLocale.split("-")[0];
  return labels[normalizedLocale]
    || labels[`${language}-${language === "zh" ? "CN" : language === "ja" ? "JP" : language === "en" ? "US" : ""}`]
    || Object.entries(labels).find(([key]) => key.split("-")[0] === language)?.[1]
    || labels["zh-CN"]
    || labels["en-US"]
    || item.name;
}

export function formatCountryCityValue(value: unknown) {
  const location = normalizeCountryCityValue(value);
  return location.path.map((item) => getLocationLabel(item)).join(" / ") || "-";
}

export function listLocationChildren(parentCode?: string, depth?: number, query = "") {
  return loadCatalog({ parentCode, depth, query, limit: 500 });
}

export function listCountries(query = "") {
  return listLocationChildren(undefined, 1, query);
}

export function listRegions(parentCode: string, query = "") {
  return parentCode ? listLocationChildren(parentCode, undefined, query) : Promise.resolve([]);
}

export function toStoredLocationItem(item: LocationCatalogItem): LocationCatalogItem {
  return {
    id: item.id,
    code: item.code,
    parentId: item.parentId ?? null,
    depth: item.depth,
    kind: item.kind,
    name: item.name,
    labels: { ...(item.labels ?? {}) },
  };
}

function loadCatalog(query: { parentCode?: string; depth?: number; query?: string; limit: number }) {
  const cacheKey = JSON.stringify(query);
  let request = catalogCache.get(cacheKey);
  if (!request) {
    request = listLocations({ query, responseStyle: "fields" })
      .then(({ data, error }) => {
        if (error || !data || data.code !== 0 || !Array.isArray(data.data)) {
          throw new Error(data?.message || "地区目录加载失败");
        }
        return data.data.filter(isLocationCatalogItem);
      })
      .catch((error) => {
        catalogCache.delete(cacheKey);
        throw error;
      });
    catalogCache.set(cacheKey, request);
  }
  return request;
}

function isLegacyCountryCityValue(value: unknown): value is LegacyCountryCityValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return isLocationItemOrNull(candidate.国家) && isLocationItemOrNull(candidate.城市);
}

function isLocationItemOrNull(value: unknown): value is LocationCatalogItem | null {
  return value === null || isLocationCatalogItem(value);
}

function isLocationCatalogItem(value: unknown): value is LocationCatalogItem {
  return Boolean(
    value
      && typeof value === "object"
      && !Array.isArray(value)
      && typeof (value as Record<string, unknown>).code === "string"
      && typeof (value as Record<string, unknown>).name === "string",
  );
}
