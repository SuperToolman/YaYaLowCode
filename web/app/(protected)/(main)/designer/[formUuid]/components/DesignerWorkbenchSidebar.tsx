"use client";

import { memo, useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Monaco } from "@monaco-editor/react";
import dynamic from "next/dynamic";
import { Button, Card, Checkbox, CheckboxGroup, Input, ListBox, Modal, Select, Switch, TextArea, Tooltip, toast } from "@heroui/react";
import {
  AddIcon,
  CodeIcon,
  GearMiniIcon,
  GridIcon,
  InfoIcon,
  ListIcon,
  MessageIcon,
  SwapIcon,
  TrashIcon,
  ToolIcon,
} from "../../../../../components/app-icons";
import { CompTool } from "./CompTool";
import type { FormDesignerSchema } from "../designer-schema";
import type {
  DesignerActionPanelState,
  DesignerDataSource,
  PageDesignerProps,
  PlacedField,
} from "../designer-types";
import type { RuntimeDebugEvent } from "../../../../../components/runtime-form-renderer";
import { AgentMarkdown } from "../../../../../components/agent-markdown";
import { AgentPanel } from "./AgentPanel";
import { fetchAvailableAgents } from "../../../../../../features/agent-assistant/api";
import type { AgentOption } from "../../../../../../features/agent-assistant/types";
import {
  getDefaultActionPanelCode,
  validateActionPanelCode,
} from "../../../../../lib/action-panel-code";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[360px] items-center justify-center rounded-2xl bg-[var(--color-code-bg)] text-sm text-[var(--color-code-text)]">
      编辑器加载中...
    </div>
  ),
});

export type DesignerPanelKey =
  | "outline"
  | "components"
  | "dataSources"
  | "indexes"
  | "agent"
  | "actions"
  | "schema";

type DesignerWorkbenchSidebarProps = {
  activePanel: DesignerPanelKey;
  fields: PlacedField[];
  formType: "normal" | "workflow" | "defined";
  pageProps: PageDesignerProps;
  schema: FormDesignerSchema;
  debugEvents: RuntimeDebugEvent[];
  onActivePanelChange: (panel: DesignerPanelKey) => void;
  onBeforeDesignerActionRegister?: (handler: (() => boolean) | null) => void;
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
    { key: "indexes", label: "索引", icon: <ListIcon /> },
    { key: "agent", label: "Agent", icon: <MessageIcon /> },
    { key: "actions", label: "动作面板", icon: <ToolIcon /> },
    { key: "schema", label: "页面源码", icon: <GearMiniIcon /> },
  ];

export const DesignerWorkbenchSidebar = memo(function DesignerWorkbenchSidebar({
  activePanel,
  fields,
  formType,
  pageProps,
  schema,
  debugEvents,
  onActivePanelChange,
  onBeforeDesignerActionRegister,
  onPagePropsChange,
}: DesignerWorkbenchSidebarProps) {
  const activePanelMeta =
    DESIGNER_PANELS.find((item) => item.key === activePanel) ?? DESIGNER_PANELS[0];
  const panelContent = renderDesignerPanelContent({
    activePanel,
    debugEvents,
    fields,
    formType,
    onBeforeDesignerActionRegister,
    onPagePropsChange,
    pageProps,
    schema,
  });

  return (
    <Card className="flex h-full min-h-0 min-w-0 flex-row gap-0 overflow-hidden p-0">
      <div className="flex h-full min-h-0 shrink-0 flex-col gap-1 pl-1">
        {DESIGNER_PANELS.map((panel) => {
          const isActive = panel.key === activePanel;
          return (
            <Button
              key={panel.key}
              isIconOnly
              aria-label={panel.label}
              variant="ghost"
              className={[
                "h-9 w-9 min-w-9 justify-center rounded-lg px-0 text-[var(--color-text-secondary)]",
                isActive
                  ? "bg-[var(--color-primary-soft)] text-[var(--color-primary)]"
                  : "hover:bg-[var(--color-bg-subtle)]",
              ].join(" ")}
              onPress={() => onActivePanelChange(panel.key)}
            >
              <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                {panel.icon}
              </span>
            </Button>
          );
        })}
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col p-1">
        <div className="mb-3 shrink-0">
          <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
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
}, areDesignerWorkbenchPropsEqual);

function areDesignerWorkbenchPropsEqual(
  previous: DesignerWorkbenchSidebarProps,
  next: DesignerWorkbenchSidebarProps,
) {
  if (previous.activePanel !== next.activePanel) return false;
  if (previous.formType !== next.formType) return false;

  // The component toolbox owns its search state and does not consume form data.
  // Avoid rebuilding it on every field move, resize, or property update.
  if (next.activePanel === "components") return true;

  return (
    previous.debugEvents === next.debugEvents &&
    previous.fields === next.fields &&
    previous.pageProps === next.pageProps &&
    previous.schema === next.schema &&
    previous.onActivePanelChange === next.onActivePanelChange &&
    previous.onBeforeDesignerActionRegister === next.onBeforeDesignerActionRegister &&
    previous.onPagePropsChange === next.onPagePropsChange
  );
}

function renderDesignerPanelContent({
  activePanel,
  debugEvents,
  fields,
  formType,
  onBeforeDesignerActionRegister,
  onPagePropsChange,
  pageProps,
  schema,
}: {
  activePanel: DesignerPanelKey;
  debugEvents: RuntimeDebugEvent[];
  fields: PlacedField[];
  formType: "normal" | "workflow" | "defined";
  onBeforeDesignerActionRegister?: (handler: (() => boolean) | null) => void;
  onPagePropsChange: (props: PageDesignerProps) => void;
  pageProps: PageDesignerProps;
  schema: FormDesignerSchema;
}) {
  if (activePanel === "outline") {
    return <OutlinePanel fields={fields} />;
  }

  if (activePanel === "components") {
    return <CompTool embedded allowCustomComponents={formType === "defined"} />;
  }

  if (activePanel === "dataSources") {
    return (
      <DataSourcesPanel
        dataSources={pageProps.dataSources}
        onChange={(dataSources) => onPagePropsChange({ ...pageProps, dataSources })}
      />
    );
  }

  if (activePanel === "indexes") {
    return (
      <IndexPanel
        fields={fields}
        value={pageProps.indexedFieldIds}
        onChange={(indexedFieldIds) => onPagePropsChange({ ...pageProps, indexedFieldIds })}
      />
    );
  }

  if (activePanel === "agent") {
    return (
      <AgentPanel
        value={pageProps.agent}
        onChange={(agent) => onPagePropsChange({ ...pageProps, agent })}
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

  return <SchemaPanel schema={schema} />;
}

const INDEXABLE_FIELD_TYPES = new Set<PlacedField["type"]>([
  "singleLineText",
  "number",
  "radio",
  "select",
  "date",
  "member",
  "department",
]);

function IndexPanel({
  fields,
  value,
  onChange,
}: {
  fields: PlacedField[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const indexableFields = fields.filter((field) => INDEXABLE_FIELD_TYPES.has(field.type));
  const indexableIds = new Set(indexableFields.map((field) => field.id));
  const selectedValue = value.filter((fieldId) => indexableIds.has(fieldId));

  if (indexableFields.length === 0) {
    return (
      <PlaceholderPanel title="暂无可建立索引的字段" />
    );
  }

  return (
    <div className="space-y-4 p-1">
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] pb-3">
        <div className="text-sm font-medium text-[var(--color-text-primary)]">字段索引</div>
        <Tooltip delay={0} closeDelay={100}>
          <Tooltip.Trigger>
            <Button isIconOnly size="sm" variant="ghost" aria-label="索引说明"><InfoIcon /></Button>
          </Tooltip.Trigger>
          <Tooltip.Content>
            保存表单时为选中字段创建普通 B-tree 索引；取消选择并再次保存后会移除对应索引。仅支持单行文本、数值、单选、下拉、日期、成员和部门字段。
          </Tooltip.Content>
        </Tooltip>
      </div>

      <CheckboxGroup
        aria-label="选择需要建立索引的字段"
        className="gap-2"
        value={selectedValue}
        onChange={(nextValue) => onChange(nextValue.map(String))}
      >
        {indexableFields.map((field) => {
          return (
            <Checkbox key={field.id} value={field.id} className="rounded-lg px-2 py-1.5 hover:bg-[var(--color-bg-subtle)]">
              <Checkbox.Content>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-medium text-[var(--color-text-primary)]">{field.label}</span>
                  <span className="mt-0.5 block truncate font-mono text-[10px] text-[var(--color-text-secondary)]" title={field.id}>{field.id}</span>
                </span>
              </Checkbox.Content>
            </Checkbox>
          );
        })}
      </CheckboxGroup>

      <p className="border-t border-[var(--color-border)] pt-3 text-xs leading-5 text-[var(--color-text-secondary)]">
        已选择 {selectedValue.length} 个字段。索引适用于筛选、匹配和排序；长文本、附件、复选、容器及子表单本身不提供普通索引。
      </p>
    </div>
  );
}

type SystemAiStatus = {
  available: boolean;
  providerId?: string;
  providerName?: string;
  reason?: string;
};

function OutlinePanel({ fields }: { fields: PlacedField[] }) {
  const rootFields = fields
    .filter((field) => !field.parentGroupId)
    .sort((left, right) => left.row - right.row || left.column - right.column);

  return (
    <div className="h-full overflow-y-auto">
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
        className="flex items-center gap-3 rounded-2xl px-3 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)]"
        style={{ paddingLeft: 12 + level * 18 }}
      >
        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-[var(--color-text-secondary)]">
          {field.type === "groupContainer" || field.type === "subform" ? <GridIcon /> : <ListIcon />}
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
      <div className="mb-3 flex flex-col items-stretch gap-2">
        <div className="min-w-0 text-xs leading-5 text-[var(--color-text-secondary)]">
          变量会注入到 <code>this.state.dataSources</code>
        </div>
        <Button
          size="sm"
          variant="primary"
          className="self-end"
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
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {dataSources.map((source) => (
          <Card
            key={source.id}
            className="p-2 shadow-none"
          >
            <div className="flex min-w-0 items-center gap-1.5">
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
              <div className="flex shrink-0 items-center justify-end">
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  aria-label={`删除变量 ${source.name}`}
                  className="text-[var(--color-danger)]"
                  onPress={() => onChange(dataSources.filter((item) => item.id !== source.id))}
                >
                  <TrashIcon />
                </Button>
              </div>
            </div>
            <div className="mt-1.5 grid grid-cols-1 gap-1.5">
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
          </Card>
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
  const [isFullscreen, setIsFullscreen] = useState(false);
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

  useEffect(() => {
    if (!isFullscreen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
      <Card
        className={[
          "border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-none",
          isFullscreen
            ? "fixed inset-0 z-[100] flex flex-col rounded-none p-4 shadow-[var(--shadow-dialog)]"
            : "rounded-2xl p-3",
        ].join(" ")}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-[var(--color-text-primary)]">统一动作编辑器</div>
            <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
              在一个脚本中统一维护 didMount、onSubmit 和 onFieldEvent
            </div>
          </div>
          <div className="flex items-center gap-2">
            <EditorFullscreenButton
              isFullscreen={isFullscreen}
              onPress={() => setIsFullscreen((current) => !current)}
            />
            <Button
              isIconOnly
              variant="ghost"
              className="h-9 w-9 min-w-9 rounded-xl text-[var(--color-text-secondary)]"
              aria-label="查看动作上下文"
              onPress={() => setIsContextOpen(true)}
            >
              <InfoIcon />
            </Button>
          </div>
        </div>
        <div className={isFullscreen ? "min-h-0 flex-1" : ""}>
          <MonacoEditor
            height={isFullscreen ? "100%" : "360px"}
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
        </div>
        {parseError ? (
          <div className="mt-2 rounded-xl border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-xs text-[var(--color-danger)]">
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
        <div className="text-xs text-[var(--color-text-secondary)]">调试日志保留最近 20 条</div>
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
      <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
        <Modal.Container placement="center" scroll="inside" size="lg">
          <Modal.Dialog className="designer-theme-surface rounded-3xl bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)]">
            <Modal.Header className="border-b border-[var(--color-border)] px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--color-primary-soft)] text-[var(--color-primary)]">
                  <CodeIcon />
                </span>
                <div>
                  <Modal.Heading className="text-lg font-semibold text-[var(--color-text-primary)]">
                    动作上下文
                  </Modal.Heading>
                  <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                    统一脚本可直接使用的生命周期、状态和工具方法
                  </p>
                </div>
              </div>
              <Modal.CloseTrigger aria-label="关闭动作上下文" />
            </Modal.Header>
            <Modal.Body className="space-y-3 px-5 py-5 text-sm text-[var(--color-text-secondary)]">
              <ContextRow code="function didMount(ctx)">页面加载完成后执行</ContextRow>
              <ContextRow code="function onFieldEvent(ctx)">任意字段事件统一入口</ContextRow>
              <ContextRow code="function onSubmit(ctx)">表单提交前执行</ContextRow>
              <ContextRow code="ctx.state.values / ctx.values">当前表单值</ContextRow>
              <ContextRow code="ctx.state.urlParams / ctx.urlParams">当前路由参数</ContextRow>
              <ContextRow code="ctx.state.dataSources / ctx.dataSources">数据源变量</ContextRow>
              <ContextRow code="ctx.fieldId / ctx.eventName / ctx.value / ctx.label">当前触发事件上下文</ContextRow>
              <ContextRow code="ctx.helpers.getFieldValue(id)">读取字段值</ContextRow>
              <ContextRow code="$(id).value / $(id).label">读取字段值与显示标签</ContextRow>
              <ContextRow code="ctx.helpers.getCascader(id)">读取级联选择的 value 与 label 路径</ContextRow>
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
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-4 py-3">
      <code className="text-xs font-semibold text-[var(--color-text-primary)]">{code}</code>
      <div className="mt-1 text-xs leading-6 text-[var(--color-text-secondary)]">{children}</div>
    </div>
  );
}

function ActionDebugPanel({ debugEvents }: { debugEvents: RuntimeDebugEvent[] }) {
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold text-[var(--color-text-primary)]">调试日志</div>
        <div className="text-xs text-[var(--color-text-secondary)]">最近 {debugEvents.length} 条</div>
      </div>
      <div className="space-y-2">
        {debugEvents.length > 0 ? (
          debugEvents.map((event) => (
            <div
              key={event.id}
              className={[
                "rounded-xl border px-3 py-2",
                event.status === "success"
                  ? "border-[var(--color-success)] bg-[var(--color-success-soft)]"
                  : "border-[var(--color-danger)] bg-[var(--color-danger-soft)]",
              ].join(" ")}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="truncate text-xs font-medium text-[var(--color-text-primary)]">
                  {event.eventName}
                  {event.fieldId ? ` / ${event.fieldId}` : ""}
                </div>
                <div
                  className={[
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                    event.status === "success"
                      ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
                      : "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
                  ].join(" ")}
                >
                  {event.status === "success" ? "成功" : "失败"}
                </div>
              </div>
              <div className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">{event.message}</div>
              {event.result ? (
                <pre className="mt-2 max-h-28 overflow-auto rounded-lg bg-[var(--color-code-bg)] px-3 py-2 text-[11px] text-[var(--color-code-text)]">
                  {event.result}
                </pre>
              ) : null}
            </div>
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-5 text-center text-xs text-[var(--color-text-secondary)]">
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
      className="h-8 min-w-0 flex-1 text-xs"
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
      className="h-8 min-w-[5rem] shrink-0 text-xs"
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

  if (fieldType === "subform") {
    return [{ id: "onRowsChange", label: "onRowsChange" }];
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
      "  getCountryCity(id: string): CountryCityValue | null;",
      "  getCascader(id: string): { value: string; label: string } | null;",
      "  setFieldValue(id: string, nextValue: unknown): void;",
      "  getDataSource(name: string): unknown;",
      "  setDataSource(name: string, nextValue: unknown): void;",
      "  eventName: string;",
      "  fieldId: string;",
      "  value: unknown;",
      "  console: Console;",
      "};",
      "declare type FieldAccessor = { id: string; type: string; value: unknown; label: string };",
      "declare function $(id: string): FieldAccessor | null;",
      "declare type LocationItem = { code: string; name: string };",
      "declare type CountryCityValue = { code: string; depth: number; path: LocationItem[] };",
      "declare type ActionContext = {",
      "  state: { values: Record<string, unknown>; urlParams: Record<string, string>; dataSources: Record<string, unknown> };",
      "  values: Record<string, unknown>;",
      "  urlParams: Record<string, string>;",
      "  dataSources: Record<string, unknown>;",
      "  fieldId: string;",
      "  eventName: string;",
      "  value: unknown;",
      "  label?: string;",
      "  helpers: ActionHelpers;",
      "  console: Console;",
      "};",
    ].join("\n"),
    "ts:action-panel-context.d.ts",
  );
}

function SchemaPanel({ schema }: { schema: FormDesignerSchema }) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const schemaMarkdown = `\`\`\`json\n${JSON.stringify(schema, null, 2).replace(/\`\`\`/g, "\`\u200b\`\`")}\n\`\`\``;

  useEffect(() => {
    if (!isFullscreen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  return (
    <div
      className={[
        "overflow-hidden border border-[var(--color-border)] bg-[var(--color-code-bg)]",
        isFullscreen
          ? "fixed inset-0 z-[100] flex flex-col rounded-none shadow-[var(--shadow-dialog)]"
          : "rounded-2xl",
      ].join(" ")}
    >
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3">
        <span className="text-xs font-medium text-[var(--color-text-primary)]">Schema（只读）</span>
        <EditorFullscreenButton
          isFullscreen={isFullscreen}
          onPress={() => setIsFullscreen((current) => !current)}
        />
      </div>
      <div className={isFullscreen ? "min-h-0 flex-1 overflow-auto p-4" : "max-h-[calc(100vh-365px)] overflow-auto p-3"}>
        <AgentMarkdown compact content={schemaMarkdown} />
      </div>
    </div>
  );
}

function EditorFullscreenButton({
  isFullscreen,
  onPress,
}: {
  isFullscreen: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      isIconOnly
      variant="ghost"
      aria-label={isFullscreen ? "退出全屏编辑" : "全屏编辑"}
      className="h-8 w-8 min-w-8 rounded-lg text-[var(--color-text-secondary)]"
      onPress={onPress}
    >
      <FullscreenIcon isFullscreen={isFullscreen} />
    </Button>
  );
}

function FullscreenIcon({ isFullscreen }: { isFullscreen: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      {isFullscreen ? (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 4v5H4m16 0h-5V4M4 15h5v5m6 0v-5h5"
        />
      ) : (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4"
        />
      )}
    </svg>
  );
}

function PlaceholderPanel({ title }: { title: string }) {
  return (
    <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-sm text-[var(--color-text-secondary)]">
      {title}待实现
    </div>
  );
}
