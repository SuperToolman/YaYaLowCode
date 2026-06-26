"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Monaco } from "@monaco-editor/react";
import dynamic from "next/dynamic";
import { Button, Card, Input, ListBox, Modal, Select, toast } from "@heroui/react";
import {
  AddIcon,
  CodeIcon,
  GearMiniIcon,
  GridIcon,
  InfoIcon,
  ListIcon,
  MessageIcon,
  SwapIcon,
  ToolIcon,
} from "../../../../components/app-icons";
import { CompTool } from "./CompTool";
import type { FormDesignerSchema } from "../designer-schema";
import type {
  DesignerActionPanelState,
  DesignerDataSource,
  PageDesignerProps,
  PlacedField,
} from "../designer-types";
import type { RuntimeDebugEvent } from "../../../../components/runtime-form-renderer";
import {
  getDefaultActionPanelCode,
  validateActionPanelCode,
} from "../../../../lib/action-panel-code";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[360px] items-center justify-center rounded-2xl bg-[#0f1726] text-sm text-[#8ea1c2]">
      编辑器加载中...
    </div>
  ),
});

export type DesignerPanelKey =
  | "outline"
  | "components"
  | "dataSources"
  | "actions"
  | "fieldOutline"
  | "schema";

type DesignerWorkbenchSidebarProps = {
  activePanel: DesignerPanelKey;
  fields: PlacedField[];
  pageProps: PageDesignerProps;
  schema: FormDesignerSchema;
  debugEvents: RuntimeDebugEvent[];
  onActivePanelChange: (panel: DesignerPanelKey) => void;
  onBeforeDesignerActionRegister?: (handler: (() => boolean) | null) => void;
  onComponentDragEnd: () => void;
  onComponentDragStart: () => void;
  onPagePropsChange: (props: PageDesignerProps) => void;
};

const DESIGNER_PANELS: Array<{
  key: DesignerPanelKey;
  label: string;
  icon: ReactNode;
}> = [
  { key: "outline", label: "大纲树", icon: <ListIcon /> },
  { key: "components", label: "组件", icon: <GridIcon /> },
  { key: "dataSources", label: "数据源", icon: <SwapIcon /> },
  { key: "actions", label: "动作面板", icon: <ToolIcon /> },
  { key: "fieldOutline", label: "字段大纲", icon: <MessageIcon /> },
  { key: "schema", label: "页面源码", icon: <GearMiniIcon /> },
];

export function DesignerWorkbenchSidebar({
  activePanel,
  fields,
  pageProps,
  schema,
  debugEvents,
  onActivePanelChange,
  onBeforeDesignerActionRegister,
  onComponentDragEnd,
  onComponentDragStart,
  onPagePropsChange,
}: DesignerWorkbenchSidebarProps) {
  const activePanelMeta =
    DESIGNER_PANELS.find((item) => item.key === activePanel) ?? DESIGNER_PANELS[0];
  const panelContent = renderDesignerPanelContent({
    activePanel,
    debugEvents,
    fields,
    onComponentDragEnd,
    onComponentDragStart,
    onBeforeDesignerActionRegister,
    onPagePropsChange,
    pageProps,
    schema,
  });

  return (
    <Card className="flex h-full min-h-0 min-w-0 flex-row items-stretch overflow-hidden rounded-[28px] border border-[#dce7f5] bg-white/90 p-2 shadow-[0_20px_60px_rgba(31,65,122,0.08)] backdrop-blur">
      <div className="flex h-full min-h-0 w-14 shrink-0 flex-col gap-2 border-r border-[#e4edf8] pr-2">
        <div className="flex min-h-0 flex-1 flex-col gap-2 pt-1">
          {DESIGNER_PANELS.map((panel) => {
            const isActive = panel.key === activePanel;
            return (
              <Button
                key={panel.key}
                isIconOnly
                aria-label={panel.label}
                variant="ghost"
                className={[
                  "h-11 w-11 min-w-11 justify-center rounded-2xl px-0 text-[#47658f]",
                  isActive ? "bg-[#edf4ff] text-[#2f6bff]" : "hover:bg-[#f7faff]",
                ].join(" ")}
                onPress={() => onActivePanelChange(panel.key)}
              >
                <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
                  {panel.icon}
                </span>
              </Button>
            );
          })}
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col pl-3">
        <div className="mb-3 shrink-0">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#7c8ca6]">
            Designer
          </p>
          <h2 className="mt-1 text-xl font-semibold text-[#14213d]">
            {activePanelMeta.label}
          </h2>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          <div key={activePanel} className="flex min-h-full min-w-0 flex-col">
            {panelContent}
          </div>
        </div>
      </div>
    </Card>
  );
}

function renderDesignerPanelContent({
  activePanel,
  debugEvents,
  fields,
  onComponentDragEnd,
  onComponentDragStart,
  onBeforeDesignerActionRegister,
  onPagePropsChange,
  pageProps,
  schema,
}: {
  activePanel: DesignerPanelKey;
  debugEvents: RuntimeDebugEvent[];
  fields: PlacedField[];
  onComponentDragEnd: () => void;
  onComponentDragStart: () => void;
  onBeforeDesignerActionRegister?: (handler: (() => boolean) | null) => void;
  onPagePropsChange: (props: PageDesignerProps) => void;
  pageProps: PageDesignerProps;
  schema: FormDesignerSchema;
}) {
  if (activePanel === "outline") {
    return <OutlinePanel fields={fields} />;
  }

  if (activePanel === "components") {
    return (
      <CompTool
        embedded
        onDragStart={onComponentDragStart}
        onDragEnd={onComponentDragEnd}
      />
    );
  }

  if (activePanel === "dataSources") {
    return (
      <DataSourcesPanel
        dataSources={pageProps.dataSources}
        onChange={(dataSources) => onPagePropsChange({ ...pageProps, dataSources })}
      />
    );
  }

  if (activePanel === "actions") {
    return (
      <ActionPanel
        actionPanel={pageProps.actionPanel}
        debugEvents={debugEvents}
        fields={fields}
        onBeforeDesignerActionRegister={onBeforeDesignerActionRegister}
        onChange={(actionPanel) => onPagePropsChange({ ...pageProps, actionPanel })}
      />
    );
  }

  if (activePanel === "fieldOutline") {
    return <PlaceholderPanel title="字段大纲" />;
  }

  return <SchemaPanel schema={schema} />;
}

function OutlinePanel({ fields }: { fields: PlacedField[] }) {
  const rootFields = fields
    .filter((field) => !field.parentGroupId)
    .sort((left, right) => left.row - right.row || left.column - right.column);

  return (
    <div className="h-full overflow-y-auto pr-1">
      <div className="space-y-1">
        {rootFields.map((field) => (
          <OutlineNode key={field.id} field={field} fields={fields} level={0} />
        ))}
      </div>
    </div>
  );
}

function OutlineNode({
  field,
  fields,
  level,
}: {
  field: PlacedField;
  fields: PlacedField[];
  level: number;
}) {
  const children = fields
    .filter((item) => item.parentGroupId === field.id)
    .sort((left, right) => left.row - right.row || left.column - right.column);

  return (
    <div>
      <div
        className="flex items-center gap-3 rounded-2xl px-3 py-2 text-sm text-[#324968] hover:bg-[#f7faff]"
        style={{ paddingLeft: 12 + level * 18 }}
      >
        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-[#7f91aa]">
          {field.type === "groupContainer" ? <GridIcon /> : <ListIcon />}
        </span>
        <span className="truncate">{field.label}</span>
      </div>
      {children.length > 0
        ? children.map((child) => (
            <OutlineNode key={child.id} field={child} fields={fields} level={level + 1} />
          ))
        : null}
    </div>
  );
}

function DataSourcesPanel({
  dataSources,
  onChange,
}: {
  dataSources: DesignerDataSource[];
  onChange: (dataSources: DesignerDataSource[]) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs text-[#60718a]">
          变量会注入到 <code>this.state.dataSources</code>
        </div>
        <Button
          size="sm"
          className="bg-[#2f6bff] text-white"
          onPress={() =>
            onChange([
              ...dataSources,
              {
                id: `ds-${Date.now()}`,
                name: "newVar",
                kind: "string",
                initialValue: "",
                description: "",
              },
            ])
          }
        >
          <AddIcon />
          新建变量
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {dataSources.map((source) => (
          <div
            key={source.id}
            className="rounded-xl border border-[#e1eaf6] bg-[#fbfdff] px-3 py-2.5"
          >
            <div className="grid grid-cols-[minmax(0,1fr)_96px_64px] gap-2">
              <CompactInput
                ariaLabel="变量名称"
                placeholder="变量名"
                value={source.name}
                onChange={(value) =>
                  onChange(
                    dataSources.map((item) =>
                      item.id === source.id ? { ...item, name: value } : item,
                    ),
                  )
                }
              />
              <CompactSelect
                ariaLabel="变量类型"
                selectedKey={source.kind}
                items={[
                  { id: "string", label: "string" },
                  { id: "number", label: "number" },
                  { id: "boolean", label: "boolean" },
                  { id: "object", label: "object" },
                ]}
                onSelectionChange={(value) =>
                  onChange(
                    dataSources.map((item) =>
                      item.id === source.id ? { ...item, kind: value as DesignerDataSource["kind"] } : item,
                    ),
                  )
                }
              />
              <div className="flex items-center justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  className="min-w-0 px-2 text-[#c24152]"
                  onPress={() => onChange(dataSources.filter((item) => item.id !== source.id))}
                >
                  删除
                </Button>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
              <CompactInput
                ariaLabel="初始值"
                placeholder="初始值"
                value={source.initialValue}
                onChange={(value) =>
                  onChange(
                    dataSources.map((item) =>
                      item.id === source.id ? { ...item, initialValue: value } : item,
                    ),
                  )
                }
              />
              <CompactInput
                ariaLabel="变量说明"
                placeholder="变量说明"
                value={source.description ?? ""}
                onChange={(value) =>
                  onChange(
                    dataSources.map((item) =>
                      item.id === source.id ? { ...item, description: value } : item,
                    ),
                  )
                }
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionPanel({
  actionPanel,
  debugEvents,
  fields,
  onBeforeDesignerActionRegister,
  onChange,
}: {
  actionPanel: DesignerActionPanelState;
  debugEvents: RuntimeDebugEvent[];
  fields: PlacedField[];
  onBeforeDesignerActionRegister?: (handler: (() => boolean) | null) => void;
  onChange: (state: DesignerActionPanelState) => void;
}) {
  const actionCode = actionPanel.code ?? getDefaultActionPanelCode();
  const [isContextOpen, setIsContextOpen] = useState(false);
  const [editorState, setEditorState] = useState(() => ({
    baseline: actionCode,
    draft: actionCode,
  }));
  const [parseError, setParseError] = useState("");
  const isDirty = editorState.draft !== editorState.baseline;
  const editorValue = isDirty ? editorState.draft : actionCode;

  const applyEditorValue = useCallback((showSuccessToast = true) => {
    const validationMessage = validateActionPanelCode(editorValue);

    if (validationMessage) {
      setParseError(validationMessage);
      toast.danger("动作脚本校验失败", {
        description: validationMessage,
      });
      return false;
    }

    try {
      const nextValue: DesignerActionPanelState = {
        code: editorValue,
      };
      setParseError("");
      setEditorState({
        baseline: editorValue,
        draft: editorValue,
      });
      onChange(nextValue);
      if (showSuccessToast) {
        toast.success("动作面板已更新", {
          description: "编辑器内容已同步到当前 schema",
        });
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "动作面板解析失败";
      setParseError(message);
      toast.danger("动作面板解析失败", {
        description: message,
      });
      return false;
    }
  }, [editorValue, onChange]);

  useEffect(() => {
    onBeforeDesignerActionRegister?.(() => applyEditorValue(false));

    return () => {
      onBeforeDesignerActionRegister?.(null);
    };
  }, [applyEditorValue, onBeforeDesignerActionRegister]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto pr-1">
      <Card className="rounded-2xl border border-[#dce7f5] bg-white p-3 shadow-none">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-[#263a5c]">统一动作编辑器</div>
            <div className="mt-1 text-xs text-[#60718a]">
              在一个脚本中统一维护 didMount、onSubmit 和 onFieldEvent
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              isIconOnly
              variant="ghost"
              className="h-9 w-9 min-w-9 rounded-xl text-[#35507b]"
              aria-label="查看动作上下文"
              onPress={() => setIsContextOpen(true)}
            >
              <InfoIcon />
            </Button>
          </div>
        </div>
        <MonacoEditor
          height="360px"
          value={editorValue}
          defaultLanguage="javascript"
          beforeMount={handleMonacoBeforeMount}
          onChange={(value) =>
            setEditorState({
              baseline: isDirty ? editorState.baseline : actionCode,
              draft: value ?? "",
            })
          }
          theme="vs-dark"
          options={{
            automaticLayout: true,
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbersMinChars: 3,
            padding: { top: 16, bottom: 16 },
            scrollBeyondLastLine: false,
            wordWrap: "on",
            tabSize: 2,
          }}
        />
        {parseError ? (
          <div className="mt-2 rounded-xl border border-[#f5d4da] bg-[#fff7f8] px-3 py-2 text-xs text-[#c24152]">
            {parseError}
          </div>
        ) : null}
      </Card>
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          onPress={() => {
            const templateValue = createActionTemplate(fields).code;
            setEditorState({
              baseline: actionCode,
              draft: templateValue,
            });
            setParseError("");
          }}
        >
          <AddIcon />
          生成模板
        </Button>
        <div className="text-xs text-[#7c8ca6]">调试日志保留最近 20 条</div>
      </div>
      <ActionDebugPanel debugEvents={debugEvents} />
      <ActionContextDialog isOpen={isContextOpen} onOpenChange={setIsContextOpen} />
    </div>
  );
}

function ActionContextDialog({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}) {
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Backdrop className="bg-[#14213d]/20" isDismissable>
        <Modal.Container placement="center" scroll="inside" size="lg">
          <Modal.Dialog className="rounded-3xl bg-white text-[#20314c] shadow-[0_30px_90px_rgba(20,33,61,0.24)]">
            <Modal.Header className="border-b border-[#eef2f7] px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[#eef4ff] text-[#2f6bff]">
                  <CodeIcon />
                </span>
                <div>
                  <Modal.Heading className="text-lg font-semibold text-[#14213d]">
                    动作上下文
                  </Modal.Heading>
                  <p className="mt-1 text-sm text-[#60718a]">
                    统一脚本可直接使用的生命周期、状态和工具方法
                  </p>
                </div>
              </div>
              <Modal.CloseTrigger aria-label="关闭动作上下文" />
            </Modal.Header>
            <Modal.Body className="space-y-3 px-5 py-5 text-sm text-[#35507b]">
              <ContextRow code="function didMount(ctx)">页面加载完成后执行</ContextRow>
              <ContextRow code="function onFieldEvent(ctx)">任意字段事件统一入口</ContextRow>
              <ContextRow code="function onSubmit(ctx)">表单提交前执行</ContextRow>
              <ContextRow code="ctx.state.values / ctx.values">当前表单值</ContextRow>
              <ContextRow code="ctx.state.urlParams / ctx.urlParams">当前路由参数</ContextRow>
              <ContextRow code="ctx.state.dataSources / ctx.dataSources">数据源变量</ContextRow>
              <ContextRow code="ctx.fieldId / ctx.eventName / ctx.value">当前触发事件上下文</ContextRow>
              <ContextRow code="ctx.helpers.getFieldValue(id)">读取字段值</ContextRow>
              <ContextRow code="ctx.helpers.setFieldValue(id, value)">更新字段值</ContextRow>
              <ContextRow code="ctx.helpers.getDataSource(name)">读取变量</ContextRow>
              <ContextRow code="ctx.helpers.setDataSource(name, value)">更新变量</ContextRow>
              <ContextRow code="console.log(...)">输出调试日志</ContextRow>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function ContextRow({
  code,
  children,
}: {
  code: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[#e1eaf6] bg-[#f8fbff] px-4 py-3">
      <code className="text-xs font-semibold text-[#20314c]">{code}</code>
      <div className="mt-1 text-xs leading-6 text-[#60718a]">{children}</div>
    </div>
  );
}

function ActionDebugPanel({ debugEvents }: { debugEvents: RuntimeDebugEvent[] }) {
  return (
    <Card className="rounded-2xl border border-[#dce7f5] bg-white p-3 shadow-none">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold text-[#263a5c]">调试日志</div>
        <div className="text-xs text-[#7c8ca6]">最近 {debugEvents.length} 条</div>
      </div>
      <div className="space-y-2">
        {debugEvents.length > 0 ? (
          debugEvents.map((event) => (
            <div
              key={event.id}
              className={[
                "rounded-xl border px-3 py-2",
                event.status === "success"
                  ? "border-[#d6f0e1] bg-[#f5fcf8]"
                  : "border-[#f5d4da] bg-[#fff7f8]",
              ].join(" ")}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="truncate text-xs font-medium text-[#20314c]">
                  {event.eventName}
                  {event.fieldId ? ` / ${event.fieldId}` : ""}
                </div>
                <div
                  className={[
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                    event.status === "success"
                      ? "bg-[#dff3e8] text-[#18794e]"
                      : "bg-[#fde2e7] text-[#c24152]",
                  ].join(" ")}
                >
                  {event.status === "success" ? "成功" : "失败"}
                </div>
              </div>
              <div className="mt-1 text-xs leading-5 text-[#60718a]">{event.message}</div>
              {event.result ? (
                <pre className="mt-2 max-h-28 overflow-auto rounded-lg bg-[#0f1726] px-3 py-2 text-[11px] text-[#d8e6ff]">
                  {event.result}
                </pre>
              ) : null}
            </div>
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-[#d6e1f4] bg-[#f7fbff] px-3 py-5 text-center text-xs text-[#7d8da8]">
            打开预览并触发动作后，这里会显示执行日志
          </div>
        )}
      </div>
    </Card>
  );
}

function CompactInput({
  ariaLabel,
  placeholder,
  value,
  onChange,
}: {
  ariaLabel: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      className="min-w-0 text-sm"
    />
  );
}

function CompactSelect({
  ariaLabel,
  items,
  selectedKey,
  onSelectionChange,
}: {
  ariaLabel: string;
  items: Array<{ id: string; label: string }>;
  selectedKey: string;
  onSelectionChange: (value: string) => void;
}) {
  return (
    <Select
      aria-label={ariaLabel}
      selectedKey={selectedKey}
      onSelectionChange={(key) => onSelectionChange(String(key ?? ""))}
      className="text-sm"
    >
      <Select.Trigger>
        <Select.Value>
          {items.find((item) => item.id === selectedKey)?.label ?? "选择类型"}
        </Select.Value>
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {items.map((item) => (
            <ListBox.Item key={item.id} id={item.id} textValue={item.label}>
              {item.label}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function getFieldEventOptions(fieldType?: PlacedField["type"]) {
  const common = [
    { id: "onChange", label: "onChange" },
    { id: "onFocus", label: "onFocus" },
    { id: "onBlur", label: "onBlur" },
  ];

  if (fieldType === "button") {
    return [{ id: "onClick", label: "onClick" }];
  }

  if (fieldType === "groupContainer") {
    return [{ id: "onChildrenChange", label: "onChildrenChange" }];
  }

  return common;
}

function createActionTemplate(fields: PlacedField[]): DesignerActionPanelState {
  const sampleField = fields[0];
  const sampleButton = fields.find((field) => field.type === "button");
  const fieldExample = sampleField
    ? [
        `  if (ctx.fieldId === "${sampleField.id}" && ctx.eventName === "${getFieldEventOptions(sampleField.type)[0]?.id ?? "onChange"}") {`,
        "    ctx.helpers.setDataSource('lastChangedField', ctx.fieldId);",
        "  }",
      ].join("\n")
    : "  // if (ctx.fieldId === 'singleLineText-1' && ctx.eventName === 'onChange') {}";
  const buttonExample = sampleButton
    ? [
        `  if (ctx.fieldId === "${sampleButton.id}" && ctx.eventName === "onClick") {`,
        "    const count = Number(ctx.helpers.getDataSource('clickCount') ?? 0);",
        "    ctx.helpers.setDataSource('clickCount', count + 1);",
        "  }",
      ].join("\n")
    : "";

  return {
    code: [
      "const formUtils = {",
      "  normalizeTitle(input) {",
      "    return String(input ?? '').trim();",
      "  },",
      "};",
      "",
      "/** @param {ActionContext} ctx */",
      "function didMount(ctx) {",
      "  const currentId = ctx.urlParams.id ?? '';",
      "  ctx.helpers.setDataSource('pageRecordId', currentId);",
      "}",
      "",
      "/** @param {ActionContext} ctx */",
      "function onFieldEvent(ctx) {",
      fieldExample,
      buttonExample ? "" : undefined,
      buttonExample || undefined,
      "}",
      "",
      "/** @param {ActionContext} ctx */",
      "function onSubmit(ctx) {",
      sampleField
        ? `  const title = formUtils.normalizeTitle(ctx.values[${JSON.stringify(sampleField.id)}]);`
        : "  const title = formUtils.normalizeTitle(ctx.values.title);",
      "  return {",
      "    ...ctx.values,",
      "    _meta: {",
      "      submittedAt: new Date().toISOString(),",
      "      title,",
      "    },",
      "  };",
      "}",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

function handleMonacoBeforeMount(monaco: Monaco) {
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
    allowNonTsExtensions: true,
    checkJs: true,
    target: monaco.languages.typescript.ScriptTarget.ES2020,
  });
  monaco.languages.typescript.javascriptDefaults.addExtraLib(
    [
      "declare type ActionHelpers = {",
      "  state: { values: Record<string, unknown>; urlParams: Record<string, string>; dataSources: Record<string, unknown> };",
      "  getFieldValue(id: string): unknown;",
      "  setFieldValue(id: string, nextValue: unknown): void;",
      "  getDataSource(name: string): unknown;",
      "  setDataSource(name: string, nextValue: unknown): void;",
      "  eventName: string;",
      "  fieldId: string;",
      "  value: unknown;",
      "  console: Console;",
      "};",
      "declare type ActionContext = {",
      "  state: { values: Record<string, unknown>; urlParams: Record<string, string>; dataSources: Record<string, unknown> };",
      "  values: Record<string, unknown>;",
      "  urlParams: Record<string, string>;",
      "  dataSources: Record<string, unknown>;",
      "  fieldId: string;",
      "  eventName: string;",
      "  value: unknown;",
      "  helpers: ActionHelpers;",
      "  console: Console;",
      "};",
    ].join("\n"),
    "ts:action-panel-context.d.ts",
  );
}

function SchemaPanel({ schema }: { schema: FormDesignerSchema }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#e1eaf6] bg-[#0f1726]">
      <MonacoEditor
        height="calc(100vh - 320px)"
        value={JSON.stringify(schema, null, 2)}
        defaultLanguage="json"
        theme="vs-dark"
        options={{
          automaticLayout: true,
          readOnly: true,
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbersMinChars: 3,
          padding: { top: 16, bottom: 16 },
          scrollBeyondLastLine: false,
          wordWrap: "on",
          tabSize: 2,
        }}
      />
    </div>
  );
}

function PlaceholderPanel({ title }: { title: string }) {
  return (
    <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-[#d6e1f4] bg-[#f7fbff] text-sm text-[#7d8da8]">
      {title}待实现
    </div>
  );
}
