import {
  getCascaderPathByValue,
  normalizeCascaderDataSource,
  serializeCascaderLabel,
} from "../lib/cascader-data-source";
import {
  isCountryCityValue,
  normalizeCountryCityValue,
  type CountryCityValue,
} from "../lib/location-catalog";
import type { RuntimeFieldType, RuntimeSchemaField } from "./runtime-form-types";

let runtimeDebugEventSequence = 0;
const recentDidMountExecutions = new Map<string, number>();
const DID_MOUNT_DEDUP_WINDOW_MS = 2000;

type RuntimeActionState = {
  values: Record<string, unknown>;
  urlParams: Record<string, string>;
  dataSources: Record<string, unknown>;
};

type RuntimeActionHelpers = {
  state: RuntimeActionState;
  getFieldValue: (id: string) => unknown;
  getCountryCity: (id: string) => CountryCityValue | null;
  getCascader: (id: string) => { value: string; label: string } | null;
  setFieldValue: (id: string, nextValue: unknown) => void;
  getDataSource: (name: string) => unknown;
  setDataSource: (name: string, nextValue: unknown) => void;
  eventName: string;
  fieldId: string;
  value: unknown;
  console: Console;
};

type RuntimeActionContext = {
  state: RuntimeActionState;
  values: Record<string, unknown>;
  urlParams: Record<string, string>;
  dataSources: Record<string, unknown>;
  fieldId: string;
  eventName: string;
  value: unknown;
  label?: string;
  helpers: RuntimeActionHelpers;
  console: Console;
};

type RuntimeFieldAccessor = {
  id: string;
  type: RuntimeFieldType;
  value: unknown;
  label: string;
};

type RuntimeActionHandler = (context: RuntimeActionContext) => unknown;

type RuntimeActionModuleHandlers = {
  didMount?: RuntimeActionHandler;
  onSubmit?: RuntimeActionHandler;
  onFieldEvent?: RuntimeActionHandler;
};

export type RuntimeActionModule = {
  handlers: RuntimeActionModuleHandlers;
  setFieldAccessor: (accessor: (id: string) => RuntimeFieldAccessor | null) => void;
  error?: string;
};

export function compileRuntimeActionModule(code: string): RuntimeActionModule {
  if (!code.trim()) {
    return createRuntimeActionModule(() => ({}));
  }

  try {
    const factory = new Function(
      "$",
      `"use strict"; ${code}
return {
  didMount: typeof didMount === "function" ? didMount : undefined,
  onSubmit: typeof onSubmit === "function" ? onSubmit : undefined,
  onFieldEvent: typeof onFieldEvent === "function" ? onFieldEvent : undefined,
};`,
    ) as ($: (id: string) => RuntimeFieldAccessor | null) => RuntimeActionModuleHandlers;

    return createRuntimeActionModule(factory);
  } catch (error) {
    return {
      handlers: {},
      setFieldAccessor: () => undefined,
      error: error instanceof Error ? error.message : "动作脚本编译失败",
    };
  }
}

export function runRuntimeActionHandler({
  actionModule,
  fields,
  handlerName,
  fieldId,
  eventName,
  dataSources,
  onError,
  onErrorEvent,
  onSuccess,
  urlParams,
  value,
  values,
}: {
  actionModule: RuntimeActionModule;
  fields: RuntimeSchemaField[];
  handlerName: keyof RuntimeActionModuleHandlers;
  fieldId: string;
  eventName: string;
  dataSources: Record<string, unknown>;
  onError?: (message: string) => void;
  onErrorEvent?: (message: string) => void;
  onSuccess?: (result: unknown) => void;
  urlParams: Record<string, string>;
  value: unknown;
  values: Record<string, unknown>;
}) {
  if (actionModule.error) {
    onError?.(actionModule.error);
    onErrorEvent?.(actionModule.error);
    return undefined;
  }

  const handler = actionModule.handlers[handlerName];
  if (!handler) return undefined;

  const state: RuntimeActionState = { values, urlParams, dataSources };
  const currentCascader = getRuntimeCascaderValue(fields, values, fieldId);
  const fieldById = new Map(fields.map((field) => [field.id, field]));
  actionModule.setFieldAccessor((id) => {
    const field = fieldById.get(id);
    if (!field) return null;
    const cascader = getRuntimeCascaderValue(fields, values, id);
    return {
      id: field.id,
      type: field.type,
      value: cascader?.value ?? values[id],
      label: cascader?.label ?? field.label,
    };
  });

  const helpers: RuntimeActionHelpers = {
    state,
    getFieldValue: (id) => values[id],
    getCountryCity: (id) => {
      const field = values[id];
      return isCountryCityValue(field) ? normalizeCountryCityValue(field) : null;
    },
    getCascader: (id) => getRuntimeCascaderValue(fields, values, id),
    setFieldValue: (id, nextValue) => {
      values[id] = nextValue;
    },
    getDataSource: (name) => dataSources[name],
    setDataSource: (name, nextValue) => {
      dataSources[name] = nextValue;
    },
    eventName,
    fieldId,
    value,
    console,
  };

  try {
    const context: RuntimeActionContext = {
      state,
      values,
      urlParams,
      dataSources,
      fieldId,
      eventName,
      value,
      label: currentCascader?.label,
      helpers,
      console,
    };
    const result = handler.call({ state }, context);
    onSuccess?.(result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知脚本错误";
    onError?.(message);
    onErrorEvent?.(message);
    console.error("[runtime-action-error]", error);
    return undefined;
  }
}

export function createRuntimeDebugEventId() {
  runtimeDebugEventSequence += 1;
  return `debug-${Date.now()}-${runtimeDebugEventSequence}`;
}

export function shouldDeduplicateDidMountExecution(executionKey: string) {
  if (process.env.NODE_ENV === "production") return false;

  const now = Date.now();
  const lastRunAt = recentDidMountExecutions.get(executionKey);
  recentDidMountExecutions.set(executionKey, now);

  for (const [key, value] of recentDidMountExecutions.entries()) {
    if (now - value > DID_MOUNT_DEDUP_WINDOW_MS) {
      recentDidMountExecutions.delete(key);
    }
  }

  return typeof lastRunAt === "number" && now - lastRunAt < DID_MOUNT_DEDUP_WINDOW_MS;
}

export function stringifyRuntimeDebugValue(value: unknown) {
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getRuntimeCascaderValue(
  fields: RuntimeSchemaField[],
  values: Record<string, unknown>,
  fieldId: string,
) {
  const field = fields.find((item) => item.id === fieldId);
  const value = values[fieldId];
  if (field?.type !== "cascader" || typeof value !== "string") return null;
  const path = getCascaderPathByValue(normalizeCascaderDataSource(field.props?.dataSource), value);
  return path.length > 0
    ? { value, label: serializeCascaderLabel(path, getRuntimeLocale()) }
    : null;
}

function getRuntimeLocale() {
  return typeof navigator === "undefined" ? "zh_CN" : navigator.language.replace("-", "_");
}

function createRuntimeActionModule(
  factory: ($: (id: string) => RuntimeFieldAccessor | null) => RuntimeActionModuleHandlers,
): RuntimeActionModule {
  let accessor: (id: string) => RuntimeFieldAccessor | null = () => null;
  const $ = (id: string) => accessor(id);
  return {
    handlers: factory($),
    setFieldAccessor: (nextAccessor) => {
      accessor = nextAccessor;
    },
  };
}
