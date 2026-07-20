import type { RuntimeSchemaField } from "../components/runtime-form-renderer";

export function getFormulaFieldKey(fieldId: string) {
  return fieldId.replace(/[^A-Za-z0-9_]/g, "_");
}

export function formulaToDisplay(formula: string, fields: RuntimeSchemaField[]) {
  let result = formula;
  for (const field of [...fields].sort((a, b) => b.id.length - a.id.length)) {
    result = result.replaceAll(`$${getFormulaFieldKey(field.id)}`, `[${field.label}]`);
  }
  return result;
}

export function formulaToStored(formula: string, fields: RuntimeSchemaField[]) {
  let result = formula;
  for (const field of [...fields].sort((a, b) => b.label.length - a.label.length)) {
    result = result.replaceAll(`[${field.label}]`, `$${getFormulaFieldKey(field.id)}`);
  }
  return result;
}

export function findDuplicateFormulaLabels(fields: RuntimeSchemaField[]) {
  const counts = new Map<string, number>();
  for (const field of fields) counts.set(field.label, (counts.get(field.label) ?? 0) + 1);
  return new Set([...counts].filter(([, count]) => count > 1).map(([label]) => label));
}

const FORMULA_FUNCTIONS: Record<string, (...args: unknown[]) => unknown> = {
  SUM: (...args) => numbers(args).reduce((sum, value) => sum + value, 0),
  AVERAGE: (...args) => {
    const values = numbers(args);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  },
  MIN: (...args) => Math.min(...numbers(args)),
  MAX: (...args) => Math.max(...numbers(args)),
  ROUND: (value, digits = 0) => {
    const factor = 10 ** toNumber(digits);
    return Math.round(toNumber(value) * factor) / factor;
  },
  ABS: (value) => Math.abs(toNumber(value)),
  CEIL: (value) => Math.ceil(toNumber(value)),
  FLOOR: (value) => Math.floor(toNumber(value)),
  POWER: (value, exponent) => toNumber(value) ** toNumber(exponent),
  MOD: (value, divisor) => toNumber(value) % toNumber(divisor),
  SQRT: (value) => Math.sqrt(toNumber(value)),
  RANDOM: () => Math.random(),
  CONCATENATE: (...args) => args.flat(Infinity).map(toText).join(""),
  LEN: (value) => (Array.isArray(value) ? value.length : toText(value).length),
  TRIM: (value) => toText(value).trim(),
  LOWER: (value) => toText(value).toLowerCase(),
  UPPER: (value) => toText(value).toUpperCase(),
  LEFT: (value, length) => toText(value).slice(0, toNumber(length)),
  RIGHT: (value, length) => toText(value).slice(-toNumber(length)),
  MID: (value, start, length) => toText(value).slice(Math.max(0, toNumber(start) - 1), Math.max(0, toNumber(start) - 1) + toNumber(length)),
  REPLACE: (value, search, replacement) => toText(value).replaceAll(toText(search), toText(replacement)),
  TEXT: (value) => toText(value),
  VALUE: (value) => toNumber(value),
  IF: (condition, truthy, falsy) => condition ? truthy : falsy,
  AND: (...args) => args.every(Boolean),
  OR: (...args) => args.some(Boolean),
  NOT: (value) => !value,
  ISBLANK: (value) => value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0),
  ISEMPTY: (value) => value === null || value === undefined || value === "",
  TODAY: () => new Date().toISOString().slice(0, 10),
  NOW: () => new Date().toISOString(),
  YEAR: (value) => new Date(toText(value)).getFullYear(),
  MONTH: (value) => new Date(toText(value)).getMonth() + 1,
  DAY: (value) => new Date(toText(value)).getDate(),
  DATE: (year, month, day) => new Date(toNumber(year), toNumber(month) - 1, toNumber(day)).toISOString().slice(0, 10),
  DATEDIF: (start, end, unit = "day") => {
    const delta = new Date(toText(end)).getTime() - new Date(toText(start)).getTime();
    const divisor = unit === "hour" ? 3_600_000 : unit === "minute" ? 60_000 : 86_400_000;
    return Math.floor(delta / divisor);
  },
  COALESCE: (...args) => args.find((value) => value !== null && value !== undefined && value !== "") ?? "",
  MAPX: (value) => value,
};

type CompiledFormula = (
  getValue: (fieldId: string) => unknown,
  callFunction: (name: string, ...args: unknown[]) => unknown,
) => unknown;

const compiledFormulaCache = new Map<string, CompiledFormula>();
const MAX_COMPILED_FORMULAS = 200;

type FormulaPlan = {
  cyclicFields: Set<string>;
  dependencies: Map<string, string[]>;
  formulaFields: RuntimeSchemaField[];
};

const formulaPlanCache = new Map<string, FormulaPlan>();

export function evaluateFormFormula(
  formula: string,
  fields: RuntimeSchemaField[],
  values: Record<string, unknown>,
) {
  const cacheKey = `${formula}\u0000${fields.map((field) => field.id).join("\u0001")}`;
  let runner = compiledFormulaCache.get(cacheKey);

  if (!runner) {
    runner = compileFormFormula(formula, fields);
    if (compiledFormulaCache.size >= MAX_COMPILED_FORMULAS) {
      compiledFormulaCache.delete(compiledFormulaCache.keys().next().value!);
    }
    compiledFormulaCache.set(cacheKey, runner);
  }

  return runner(
    (fieldId) => values[fieldId],
    (name, ...args) => {
      const formulaFunction = FORMULA_FUNCTIONS[name.toUpperCase()];
      if (!formulaFunction) throw new Error(`不支持的函数：${name}`);
      return formulaFunction(...args);
    },
  );
}

function compileFormFormula(
  formula: string,
  fields: RuntimeSchemaField[],
): CompiledFormula {
  const fieldByKey = new Map(fields.map((field) => [getFormulaFieldKey(field.id), field]));
  let expression = formula.trim().replace(/@([A-Za-z][A-Za-z0-9_]*)\s*\(/g, '__fn("$1",');
  expression = expression.replace(/\$([A-Za-z0-9_]+)/g, (_match, key: string) => {
    const field = fieldByKey.get(key);
    if (!field) throw new Error(`未找到组件引用：${key}`);
    return `__get(${JSON.stringify(field.id)})`;
  });
  expression = expression.replace(/\bTRUE\b/gi, "true").replace(/\bFALSE\b/gi, "false");

  const residue = expression
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "")
    .replace(/__get\(\s*\)/g, "")
    .replace(/__fn\(\s*,/g, "")
    .replace(/\b(?:true|false|null)\b/g, "")
    .replace(/[0-9eE.()+\-*/%<>=!&,|?:\s]/g, "");
  if (residue) throw new Error(`公式包含不支持的内容：${residue}`);

  return new Function("__get", "__fn", `"use strict"; return (${expression});`) as CompiledFormula;
}

export function calculateFormulaValues(
  fields: RuntimeSchemaField[],
  sourceValues: Record<string, unknown>,
  options?: { changedFieldIds?: Iterable<string> },
) {
  const values = { ...sourceValues };
  const { cyclicFields, dependencies, formulaFields } = getFormulaPlan(fields);
  const errors: Record<string, string> = {};
  for (const fieldId of cyclicFields) errors[fieldId] = "公式存在循环引用";
  const affectedFormulaFields = options?.changedFieldIds
    ? findAffectedFormulaFields(dependencies, options.changedFieldIds)
    : undefined;

  for (let pass = 0; pass < Math.max(1, formulaFields.length); pass += 1) {
    let changed = false;
    for (const field of formulaFields) {
      if (affectedFormulaFields && !affectedFormulaFields.has(field.id)) continue;
      if (cyclicFields.has(field.id)) continue;
      try {
        const nextValue = evaluateFormFormula(field.props?.defaultValueFormula ?? "", fields, values);
        if (!Object.is(values[field.id], nextValue)) {
          values[field.id] = nextValue;
          changed = true;
        }
        delete errors[field.id];
      } catch (error) {
        errors[field.id] = error instanceof Error ? error.message : "公式计算失败";
      }
    }
    if (!changed) break;
  }

  return { values, errors };
}

function getFormulaPlan(fields: RuntimeSchemaField[]): FormulaPlan {
  const cacheKey = fields
    .map((field) => `${field.id}\u0000${field.props?.defaultValueType ?? ""}\u0000${field.props?.defaultValueFormula ?? ""}`)
    .join("\u0001");
  const cached = formulaPlanCache.get(cacheKey);
  if (cached) return cached;

  const formulaFields = fields.filter(
    (field) => field.props?.defaultValueType === "formula" && field.props.defaultValueFormula?.trim(),
  );
  const fieldByKey = new Map(fields.map((field) => [getFormulaFieldKey(field.id), field.id]));
  const dependencies = new Map(
    formulaFields.map((field) => [
      field.id,
      [...(field.props?.defaultValueFormula ?? "").matchAll(/\$([A-Za-z0-9_]+)/g)]
        .map((match) => fieldByKey.get(match[1]))
        .filter((fieldId): fieldId is string => Boolean(fieldId)),
    ]),
  );
  const plan = {
    formulaFields,
    dependencies,
    cyclicFields: findCyclicFormulaFields(dependencies),
  };

  if (formulaPlanCache.size >= MAX_COMPILED_FORMULAS) {
    formulaPlanCache.delete(formulaPlanCache.keys().next().value!);
  }
  formulaPlanCache.set(cacheKey, plan);
  return plan;
}

function findCyclicFormulaFields(dependencies: Map<string, string[]>) {
  const cyclic = new Set<string>();
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(fieldId: string, path: string[]) {
    if (visiting.has(fieldId)) {
      const cycleStart = path.indexOf(fieldId);
      for (const item of path.slice(Math.max(0, cycleStart))) cyclic.add(item);
      cyclic.add(fieldId);
      return;
    }
    if (visited.has(fieldId)) return;
    visiting.add(fieldId);
    for (const dependency of dependencies.get(fieldId) ?? []) {
      if (dependencies.has(dependency)) visit(dependency, [...path, fieldId]);
    }
    visiting.delete(fieldId);
    visited.add(fieldId);
  }

  for (const fieldId of dependencies.keys()) visit(fieldId, []);
  return cyclic;
}

function findAffectedFormulaFields(
  dependencies: Map<string, string[]>,
  changedFieldIds: Iterable<string>,
) {
  const changed = new Set(changedFieldIds);
  const affected = new Set<string>();
  let found = true;

  while (found) {
    found = false;
    for (const [fieldId, fieldDependencies] of dependencies) {
      if (affected.has(fieldId) || !fieldDependencies.some((dependency) => changed.has(dependency))) {
        continue;
      }
      affected.add(fieldId);
      changed.add(fieldId);
      found = true;
    }
  }

  return affected;
}

function numbers(values: unknown[]) {
  return values.flat(Infinity).map(toNumber).filter(Number.isFinite);
}

function toNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function toText(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}
