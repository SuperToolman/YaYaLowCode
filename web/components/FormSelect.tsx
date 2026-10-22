"use client";
import { assertApiEnvelope } from "@lib/api-request";


import {
  Button,
  Checkbox,
  Chip,
  Input,
  ListBox,
  Label,
  Popover,
  Select,
  Tabs,
} from "@heroui/react";
import { useEffect, useId, useState } from "react";
import { useAuth } from "@/app/components/AuthProvider";
import { getAppForms, getAppResource } from "@/app/lib/app-resources";
import { listApps } from "@/app/lib/http";
import { ChevronDown } from "@gravity-ui/icons";

export type SelectableFormType = "normal" | "defined" | "workflow";
export type FormSelectOption = {
  id: string;
  name: string;
  formType: string;
  /** 跨应用候选必须携带所属应用；省略时属于组件的 appId。 */
  appId?: string;
  appName?: string;
};

const FORM_TYPES: readonly SelectableFormType[] = [
  "normal",
  "defined",
  "workflow",
];
const TYPE_LABELS: Record<SelectableFormType, string> = {
  normal: "普通表单",
  defined: "自定义页面",
  workflow: "流程表单",
};

export type FormSelectProps = {
  appId: string;
  forms: readonly FormSelectOption[];
  formTypes?: readonly SelectableFormType[];
  /** 是否允许选择跨应用表单，默认允许。 */
  allowCrossApp?: boolean;
  /** 在可见权限之外，额外要求该表单操作权限。 */
  requiredAction?: "create" | "edit" | "delete";
  /** 单选时返回选中表单元数据，供跨应用配置保存所属应用。 */
  onFormSelect?: (form: FormSelectOption) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  isDisabled?: boolean;
  label?: string;
  isRequired?: boolean;
} & (
  | {
      selectionMode?: "single";
      value: string;
      onChange: (value: string) => void;
    }
  | {
      selectionMode: "multiple";
      value: string[];
      onChange: (value: string[]) => void;
    }
);

/** options 可以复用页面加载的列表；组件始终按当前登录权限再次过滤。 */
export function FormSelect(props: FormSelectProps) {
  const labelId = useId();
  const triggerId = useId();
  const { hasPermission, permissionsReady, permissions, token } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("all");
  const [appScope, setAppScope] = useState<"current" | "cross">("current");
  const allowCrossApp = props.allowCrossApp ?? true;
  const activeAppScope = allowCrossApp ? appScope : "current";
  const [appNames, setAppNames] = useState<Record<string, string>>({});
  const [crossResult, setCrossResult] = useState<{
    key: string;
    forms: FormSelectOption[];
    error: string;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const selectedIds =
    props.selectionMode === "multiple" ? props.value : [props.value];
  const needsSelectedForms = selectedIds.some(
    (id) => id && !props.forms.some((form) => form.id === id),
  );
  const permissionsKey = JSON.stringify(permissions);
  const crossKey = JSON.stringify([props.appId, token, permissionsKey, retry]);
  const shouldLoadCross =
    allowCrossApp &&
    permissionsReady &&
    ((isOpen && appScope === "cross") || needsSelectedForms);
  const crossForms = crossResult?.key === crossKey ? crossResult.forms : [];
  const crossError = crossResult?.key === crossKey ? crossResult.error : "";
  const crossLoading = shouldLoadCross && crossResult?.key !== crossKey;
  const allForms = [
    ...new Map(
      [...crossForms, ...props.forms].map((form) => [form.id, form]),
    ).values(),
  ];

  useEffect(() => {
    if (!shouldLoadCross || crossResult?.key === crossKey) return;
    let cancelled = false;
    const grants: string[] = JSON.parse(permissionsKey);
    void (async () => {
      try {
        const { data, error , response: httpResponse0 } = await listApps({ responseStyle: "fields" });
        assertApiEnvelope(data, error, httpResponse0);
        const apps = data.data.filter(
          (app) =>
            app.id !== props.appId &&
            (grants.includes("*") || grants.includes(`app:${app.id}:display`)),
        );
        const results = await Promise.allSettled(
          apps.map(async (app) =>
            (await getAppForms(app.id)).map((form) => ({
              ...form,
              appId: app.id,
              appName: app.name,
            })),
          ),
        );
        const forms = results.flatMap((result) =>
          result.status === "fulfilled" ? result.value : [],
        );
        const failed = results.some((result) => result.status === "rejected");
        if (!cancelled)
          setCrossResult({
            key: crossKey,
            forms,
            error: failed ? "部分跨应用表单加载失败" : "",
          });
      } catch {
        if (!cancelled)
          setCrossResult({
            key: crossKey,
            forms: [],
            error: "跨应用表单加载失败",
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    shouldLoadCross,
    crossKey,
    permissionsKey,
    props.appId,
    crossResult?.key,
  ]);
  const types = [...new Set(props.formTypes ?? FORM_TYPES)];
  const showTypes = types.length > 1;
  const activeTab =
    showTypes && types.some((type) => type === tab) ? tab : "all";
  const allowedForms = allForms.filter(
    (form) =>
      (allowCrossApp || (form.appId ?? props.appId) === props.appId) &&
      permissionsReady &&
      hasPermission(`app:${form.appId ?? props.appId}:display`) &&
      types.some((type) => type === form.formType) &&
      hasPermission(`form:${form.id}:display`) &&
      (!props.requiredAction ||
        hasPermission(`form:${form.id}:${props.requiredAction}`)),
  );
  const appIdsToLoad = JSON.stringify([
    ...new Set(
      allowedForms
        .filter((form) => !form.appName)
        .map((form) => form.appId ?? props.appId),
    ),
  ]);
  useEffect(() => {
    let cancelled = false;
    const ids: string[] = JSON.parse(appIdsToLoad);
    if (!ids.length) return;
    void Promise.all(
      ids.map(async (id) => {
        try {
          const app = await getAppResource(id);
          return [id, app.name] as const;
        } catch {
          return [id, "应用名称不可用"] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled) setAppNames(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [appIdsToLoad]);

  function appLabel(form: FormSelectOption) {
    const id = form.appId ?? props.appId;
    return form.appName || appNames[id] || "加载应用名称…";
  }

  function formLabel(form: FormSelectOption) {
    return `${appLabel(form)} / ${form.name}`;
  }
  const selected = allowedForms.filter((form) => selectedIds.includes(form.id));
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const visibleForms = allowedForms.filter(
    (form) =>
      (activeAppScope === "current"
        ? (form.appId ?? props.appId) === props.appId
        : (form.appId ?? props.appId) !== props.appId) &&
      (activeTab === "all" || form.formType === activeTab) &&
      (!normalizedQuery ||
        `${form.name} ${appLabel(form)} ${form.id}`
          .toLocaleLowerCase("zh-CN")
          .includes(normalizedQuery)),
  );
  const placeholder = props.placeholder ?? "选择表单";

  function select(id: string, checked: boolean) {
    if (props.selectionMode === "multiple") {
      // 不把已经失去权限或不在范围内的旧选择带入下一次配置。
      const current = selected.map((form) => form.id);
      props.onChange(
        checked
          ? [...new Set([...current, id])]
          : current.filter((item) => item !== id),
      );
    } else {
      const option = allowedForms.find((form) => form.id === id);
      if (option)
        props.onFormSelect?.({ ...option, appId: option.appId ?? props.appId });
      props.onChange(id);
      setIsOpen(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {props.label ? (
        <Label
          id={labelId}
          htmlFor={triggerId}
          isRequired={props.isRequired}
          isDisabled={props.isDisabled}
        >
          {props.label}
        </Label>
      ) : null}
      <Popover isOpen={isOpen} onOpenChange={setIsOpen}>
        <Button
          id={triggerId}
          aria-label={props.label ? undefined : placeholder}
          aria-labelledby={props.label ? labelId : undefined}
          isDisabled={props.isDisabled || !permissionsReady}
          className="input flex w-full min-w-0 items-center justify-between text-left text-sm font-normal"
        >
          <span
            className="min-w-0 truncate"
            title={selected.map(formLabel).join("、")}
          >
            {selected.length ? selected.map(formLabel).join("、") : placeholder}
          </span>
          <span
            aria-hidden="true"
            className="text-[var(--color-text-secondary)]"
          >
            <ChevronDown />
          </span>
        </Button>
        <Popover.Content className="w-[360px] max-w-[calc(100vw-2rem)]">
          <Popover.Dialog aria-label={placeholder} className="w-full">
            <div className="flex items-center gap-2">
              {allowCrossApp ? (
                <Select
                  aria-label="应用筛选"
                  selectedKey={appScope}
                  onSelectionChange={(key) =>
                    setAppScope(key === "cross" ? "cross" : "current")
                  }
                  className="w-28 shrink-0"
                >
                  <Select.Trigger>
                    <Select.Value>
                      {appScope === "current" ? "当前应用" : "跨应用"}
                    </Select.Value>
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item id="current" textValue="当前应用">
                        当前应用
                      </ListBox.Item>
                      <ListBox.Item id="cross" textValue="跨应用">
                        跨应用
                      </ListBox.Item>
                    </ListBox>
                  </Select.Popover>
                </Select>
              ) : null}
              <Input
                fullWidth
                className="min-w-0 flex-1"
                aria-label={props.searchPlaceholder ?? "搜索表单"}
                placeholder={props.searchPlaceholder ?? "搜索表单"}
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </div>
            {showTypes ? (
              <Tabs
                variant="secondary"
                selectedKey={activeTab}
                onSelectionChange={(key) => setTab(String(key))}
              >
                <Tabs.ListContainer>
                  <Tabs.List aria-label="表单类型筛选" className="w-full">
                    <Tabs.Tab id="all" className="flex-1 text-xs">
                      全部
                      <Tabs.Indicator />
                    </Tabs.Tab>
                    {types.map((type) => (
                      <Tabs.Tab key={type} id={type} className="flex-1 text-xs">
                        {TYPE_LABELS[type]}
                        <Tabs.Indicator />
                      </Tabs.Tab>
                    ))}
                  </Tabs.List>
                </Tabs.ListContainer>
              </Tabs>
            ) : null}
            <div className="mt-2 flex max-h-56 flex-col gap-1 overflow-y-auto overscroll-contain">
              {visibleForms.map((form) => {
                const content = (
                  <>
                    <span className="min-w-0 flex-1" title={formLabel(form)}>
                      <span className="block truncate">{form.name}</span>
                      <span className="block truncate text-xs text-[var(--color-text-secondary)]">
                        {appLabel(form)}
                      </span>
                    </span>
                    {showTypes ? (
                      <Chip size="sm" variant="soft">
                        {TYPE_LABELS[form.formType as SelectableFormType]}
                      </Chip>
                    ) : null}
                  </>
                );
                return props.selectionMode === "multiple" ? (
                  <Checkbox
                    key={form.id}
                    isSelected={selectedIds.includes(form.id)}
                    onChange={(checked) => select(form.id, checked)}
                  >
                    <Checkbox.Content className="flex w-full min-w-0 items-center gap-2">
                      <Checkbox.Control>
                        <Checkbox.Indicator />
                      </Checkbox.Control>
                      {content}
                    </Checkbox.Content>
                  </Checkbox>
                ) : (
                  <button
                    key={form.id}
                    type="button"
                    aria-pressed={selectedIds.includes(form.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-[var(--color-control-soft-hover)] aria-pressed:bg-[var(--color-control-soft)]"
                    onClick={() => select(form.id, true)}
                  >
                    {content}
                  </button>
                );
              })}
              {activeAppScope === "cross" && crossLoading ? (
                <p
                  role="status"
                  className="px-2 py-3 text-xs text-[var(--color-text-secondary)]"
                >
                  正在加载跨应用表单…
                </p>
              ) : null}
              {activeAppScope === "cross" && crossError ? (
                <div
                  role="alert"
                  className="flex items-center gap-2 px-2 text-xs"
                >
                  <span>{crossError}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onPress={() => setRetry((value) => value + 1)}
                  >
                    重试
                  </Button>
                </div>
              ) : null}
              {!visibleForms.length &&
              !(activeAppScope === "cross" && (crossLoading || crossError)) ? (
                <p
                  role="status"
                  className="px-2 py-3 text-xs text-[var(--color-text-secondary)]"
                >
                  {normalizedQuery ? "未找到表单" : "暂无可选择的表单"}
                </p>
              ) : null}
            </div>
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </div>
  );
}
