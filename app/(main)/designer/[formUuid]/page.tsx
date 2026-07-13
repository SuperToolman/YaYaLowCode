"use client";

import { use, useEffect, useRef, useState } from "react";
import type { MouseEvent, PointerEvent } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { toast } from "@heroui/react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  getDefaultDesignerFieldProps,
  getDesignerComponent,
  type DesignerFieldProps,
} from "./components/CompTool";
import { DesignerCanvas } from "./components/DesignerCanvas";
import {
  DesignerWorkbenchSidebar,
  type DesignerPanelKey,
} from "./components/DesignerWorkbenchSidebar";
import { FieldPropertyDrawer } from "./components/field-properties/FieldPropertyDrawer";
import { FormPreviewModal } from "./components/FormPreviewModal";
import { FormDesignerHeader } from "./components/FormDesignerHeader";
import type { FormVersionSummary } from "./components/FormDesignerHeader";
import { PagePropertyDrawer } from "./components/page-properties/PagePropertyDrawer";
import { CELL_MIN_HEIGHT, COLUMN_COUNT, GRID_ROW_GAP } from "./designer-constants";
import {
  canPlaceField,
  getColumnStep,
  getInitialFieldLayout,
  getRowCount,
  moveField,
  resizeField,
} from "./designer-layout";
import { buildSchema } from "./designer-schema";
import type { FormDesignerSchema } from "./designer-schema";
import { getDefaultPageDesignerProps, normalizePageDesignerProps } from "./designer-schema";
import type {
  DesignerDragData,
  DesignerDropData,
  FormDesignerProps,
  PageDesignerProps,
  PlacedField,
  ResizeDirection,
  ResizeState,
} from "./designer-types";
import type { RuntimeDebugEvent } from "../../../components/runtime-form-renderer";
import { getFormulaFieldKey } from "../../../lib/form-formula";

export default function FormDesigner({ params }: FormDesignerProps) {
  const DESIGNER_WORKBENCH_MIN_WIDTH = 360;
  const DESIGNER_WORKBENCH_MAX_WIDTH = 860;
  const { formUuid } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const appId = searchParams.get("appId");
  const [appName, setAppName] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const resizeStateRef = useRef<ResizeState | null>(null);
  const beforeDesignerActionRef = useRef<(() => boolean) | null>(null);
  const workbenchResizeStateRef = useRef<{
    startX: number;
    startWidth: number;
  } | null>(null);
  const [formName, setFormName] = useState("New Page");
  const [isEditingFormName, setIsEditingFormName] = useState(false);
  const [fields, setFields] = useState<PlacedField[]>([]);
  const [pageProps, setPageProps] = useState<PageDesignerProps>(() =>
    getDefaultPageDesignerProps(),
  );
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [inspectorFieldId, setInspectorFieldId] = useState<string | null>(null);

  const rowCount = getRowCount(fields);
  const showMatrix = isDragging || isResizing;
  const currentSchema = buildSchema(formUuid, formName, fields, pageProps);
  const inspectorField =
    fields.find((field) => field.id === inspectorFieldId) ?? null;
  const [isPagePropertiesOpen, setIsPagePropertiesOpen] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [latestVersion, setLatestVersion] = useState(1);
  const [publishedVersion, setPublishedVersion] = useState(1);
  const [versions, setVersions] = useState<FormVersionSummary[]>([]);
  const [activeDesignerPanel, setActiveDesignerPanel] =
    useState<DesignerPanelKey>("components");
  const [debugEvents, setDebugEvents] = useState<RuntimeDebugEvent[]>([]);
  const [workbenchWidth, setWorkbenchWidth] = useState(420);
  const [activeDragData, setActiveDragData] = useState<DesignerDragData | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  const historyRef = useRef<DesignerHistory | null>(null);
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isApplyingHistoryRef = useRef(false);
  const copiedFieldsRef = useRef<PlacedField[]>([]);

  useEffect(() => {
    if (!appId) {
      return;
    }

    let cancelled = false;

    void fetch(`/api/apps/${appId}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { code: number; data: { name?: string } | null }) => {
        if (!cancelled && payload.code === 0 && payload.data?.name) {
          setAppName(payload.data.name);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [appId]);

  useEffect(() => {
    const nextSnapshot = createDesignerSnapshot(formName, fields, pageProps);

    if (isApplyingHistoryRef.current) {
      isApplyingHistoryRef.current = false;
      return;
    }

    if (!historyRef.current) {
      historyRef.current = { past: [], present: nextSnapshot, future: [] };
      return;
    }

    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = setTimeout(() => {
      commitDesignerSnapshot(nextSnapshot);
      historyTimerRef.current = null;
    }, 180);

    return () => {
      if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    };
  }, [fields, formName, pageProps]);

  useEffect(() => {
    let cancelled = false;

    async function loadSchema() {
      try {
        const response = await fetch(`/api/forms/${formUuid}/schema?scope=draft`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          code: number;
          data: {
            schema: FormDesignerSchema;
            version: number;
            latestVersion: number;
            publishedVersion: number;
          } | null;
          message: string;
        };

        if (cancelled || payload.code !== 0 || !payload.data?.schema) {
          return;
        }

        const nextSchema = payload.data.schema;
        const nextFields = (nextSchema.fields as PlacedField[]).map((field) => ({
            ...field,
            parentGroupId: field.parentGroupId ?? null,
          }));
        const nextPageProps = normalizePageDesignerProps(nextSchema.pageProps);
        const nextFormName = nextSchema.formName || "New Page";
        resetDesignerHistory(nextFormName, nextFields, nextPageProps);
        setFormName(nextFormName);
        setFields(nextFields);
        setPageProps(nextPageProps);
        setLatestVersion(payload.data.latestVersion);
        setPublishedVersion(payload.data.publishedVersion);
      } catch {
        // Keep the blank local state when backend schema is unavailable.
      }
    }

    async function loadVersions() {
      try {
        const response = await fetch(`/api/forms/${formUuid}/versions`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          code: number;
          data: FormVersionSummary[] | null;
        };

        if (!cancelled && payload.code === 0 && payload.data) {
          setVersions(payload.data.slice(0, 20));
        }
      } catch {
        // Keep local version state if backend versions are unavailable.
      }
    }

    void loadSchema();
    void loadVersions();

    return () => {
      cancelled = true;
    };
  }, [formUuid]);

  useEffect(() => {
    function handleDesignerKeyDown(event: globalThis.KeyboardEvent) {
      if (isEditableKeyboardTarget(event.target)) return;

      const key = event.key.toLowerCase();
      const hasCommandModifier = event.ctrlKey || event.metaKey;

      if (hasCommandModifier && key === "c") {
        const selectedField = fields.find((field) => field.id === selectedFieldId);
        if (!selectedField) return;
        event.preventDefault();
        copiedFieldsRef.current = cloneFields(getFieldSubtree(fields, selectedField.id));
        return;
      }

      if (hasCommandModifier && key === "v") {
        if (copiedFieldsRef.current.length === 0) return;
        event.preventDefault();
        pasteCopiedFields();
        return;
      }

      if (hasCommandModifier && key === "z" && !event.shiftKey) {
        event.preventDefault();
        undoDesignerChange();
        return;
      }

      if (hasCommandModifier && (key === "y" || (key === "z" && event.shiftKey))) {
        event.preventDefault();
        redoDesignerChange();
        return;
      }

      if (event.key === "Delete" && selectedFieldId) {
        event.preventDefault();
        removeField(selectedFieldId);
      }
    }

    window.addEventListener("keydown", handleDesignerKeyDown);
    return () => window.removeEventListener("keydown", handleDesignerKeyDown);
  }, [fields, formName, pageProps, selectedFieldId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function handlePointerMove(event: globalThis.PointerEvent) {
      const resizeState = workbenchResizeStateRef.current;

      if (!resizeState) {
        return;
      }

      const nextWidth = resizeState.startWidth + (event.clientX - resizeState.startX);
      setWorkbenchWidth(
        Math.max(DESIGNER_WORKBENCH_MIN_WIDTH, Math.min(DESIGNER_WORKBENCH_MAX_WIDTH, nextWidth)),
      );
    }

    function handlePointerUp() {
      workbenchResizeStateRef.current = null;
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  function endDragging() {
    setIsDragging(false);
    setActiveDragData(null);
  }

  function endResizing() {
    resizeStateRef.current = null;
    setIsResizing(false);
  }

  function handleDesignerDragStart(event: DragStartEvent) {
    const dragData = event.active.data.current as DesignerDragData | undefined;

    if (!dragData || (dragData.kind !== "component" && dragData.kind !== "field")) {
      return;
    }

    setActiveDragData(dragData);
    setIsDragging(true);
    setSelectedFieldId(null);
    setInspectorFieldId(null);
  }

  function handleDesignerDragEnd(event: DragEndEvent) {
    const dragData = event.active.data.current as DesignerDragData | undefined;
    const dropData = event.over?.data.current as DesignerDropData | undefined;

    endDragging();

    if (!dragData || !dropData || dropData.kind !== "cell") {
      return;
    }

    const { column, parentGroupId, row } = dropData;

    setFields((currentFields) => {
      if (dragData.kind === "field") {
        return moveField(
          currentFields,
          dragData.fieldId,
          row,
          column,
          parentGroupId,
        );
      }

      const componentType = dragData.componentType;
      const component = getDesignerComponent(componentType);
      const nextIndex =
        currentFields.filter((field) => field.type === componentType).length + 1;
      const initialLayout = getInitialFieldLayout(componentType);

      if (
        !canPlaceField(
          currentFields,
          null,
          row,
          column,
          initialLayout.rowSpan,
          initialLayout.colSpan,
          parentGroupId,
        )
      ) {
        return currentFields;
      }

      return [
        ...currentFields,
        {
          id: `${componentType}-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,
          type: componentType,
          label: `${component.label}${nextIndex}`,
          row,
          column,
          rowSpan: initialLayout.rowSpan,
          colSpan: initialLayout.colSpan,
          props: getDefaultDesignerFieldProps(componentType),
          parentGroupId,
        },
      ];
    });
  }

  function handleResizePointerDown(
    event: PointerEvent<HTMLButtonElement>,
    field: PlacedField,
    direction: ResizeDirection,
  ) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStateRef.current = {
      fieldId: field.id,
      startX: event.clientX,
      startY: event.clientY,
      startRowSpan: field.rowSpan,
      startColSpan: field.colSpan,
      direction,
    };
    setSelectedFieldId(field.id);
    setInspectorFieldId(null);
    setIsResizing(true);
  }

  function handleResizePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const resizeState = resizeStateRef.current;
    const grid = gridRef.current;

    if (!resizeState || !grid) {
      return;
    }

    const columnStep = getColumnStep(grid);
    const rowStep = CELL_MIN_HEIGHT + GRID_ROW_GAP;
    const deltaColumns = Math.round(
      (event.clientX - resizeState.startX) / columnStep,
    );
    const deltaRows = Math.round(
      (event.clientY - resizeState.startY) / rowStep,
    );

    setFields((currentFields) =>
      resizeField(currentFields, resizeState, deltaRows, deltaColumns),
    );
  }

  function selectField(event: MouseEvent<HTMLDivElement>, fieldId: string) {
    event.stopPropagation();
    setSelectedFieldId(fieldId);
  }

  function openFieldProperties(event: MouseEvent<HTMLElement>, fieldId: string) {
    event.stopPropagation();
    setSelectedFieldId(fieldId);
    setIsPagePropertiesOpen(false);
    setInspectorFieldId(fieldId);
  }

  function openPageProperties(event: MouseEvent<HTMLDivElement>) {
    event.stopPropagation();
    setSelectedFieldId(null);
    setInspectorFieldId(null);
    setIsPagePropertiesOpen(true);
  }

  function updateFieldLabel(fieldId: string, label: string) {
    setFields((currentFields) =>
      currentFields.map((field) =>
        field.id === fieldId ? { ...field, label } : field,
      ),
    );
  }

  function updateFieldProps(fieldId: string, props: DesignerFieldProps) {
    setFields((currentFields) =>
      currentFields.map((field) =>
        field.id === fieldId
          ? { ...field, props: { ...field.props, ...props } }
          : field,
      ),
    );
  }

  function removeField(fieldId: string) {
    setFields((currentFields) => {
      const removedIds = new Set(getFieldSubtree(currentFields, fieldId).map((field) => field.id));
      return currentFields.filter((field) => !removedIds.has(field.id));
    });
    setSelectedFieldId(null);
    setInspectorFieldId(null);
  }

  function commitDesignerSnapshot(snapshot: DesignerSnapshot) {
    const history = historyRef.current;
    if (!history) {
      historyRef.current = { past: [], present: snapshot, future: [] };
      return;
    }
    if (areDesignerSnapshotsEqual(history.present, snapshot)) return;
    historyRef.current = {
      past: [...history.past, history.present].slice(-100),
      present: snapshot,
      future: [],
    };
  }

  function flushDesignerHistory() {
    if (historyTimerRef.current) {
      clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
    }
    commitDesignerSnapshot(createDesignerSnapshot(formName, fields, pageProps));
  }

  function resetDesignerHistory(
    nextFormName: string,
    nextFields: PlacedField[],
    nextPageProps: PageDesignerProps,
  ) {
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = null;
    historyRef.current = {
      past: [],
      present: createDesignerSnapshot(nextFormName, nextFields, nextPageProps),
      future: [],
    };
    isApplyingHistoryRef.current = true;
  }

  function applyDesignerSnapshot(snapshot: DesignerSnapshot) {
    isApplyingHistoryRef.current = true;
    setFormName(snapshot.formName);
    setFields(cloneFields(snapshot.fields));
    setPageProps(clonePageProps(snapshot.pageProps));
    setSelectedFieldId(null);
    setInspectorFieldId(null);
    setIsPagePropertiesOpen(false);
  }

  function undoDesignerChange() {
    flushDesignerHistory();
    const history = historyRef.current;
    if (!history || history.past.length === 0) return;
    const previous = history.past[history.past.length - 1];
    historyRef.current = {
      past: history.past.slice(0, -1),
      present: previous,
      future: [history.present, ...history.future].slice(0, 100),
    };
    applyDesignerSnapshot(previous);
  }

  function redoDesignerChange() {
    flushDesignerHistory();
    const history = historyRef.current;
    if (!history || history.future.length === 0) return;
    const next = history.future[0];
    historyRef.current = {
      past: [...history.past, history.present].slice(-100),
      present: next,
      future: history.future.slice(1),
    };
    applyDesignerSnapshot(next);
  }

  function pasteCopiedFields() {
    const copiedFields = copiedFieldsRef.current;
    if (copiedFields.length === 0) return;
    const idMap = new Map(
      copiedFields.map((field) => [field.id, createPastedFieldId(field.type)]),
    );
    const minimumCopiedRow = Math.min(...copiedFields.map((field) => field.row));
    const pasteStartRow = getRowCount(fields);
    const pastedFields = copiedFields.map((field) => {
      const clonedField = cloneField(field);
      return {
        ...clonedField,
        id: idMap.get(field.id)!,
        label: `${field.label} 副本`,
        row: pasteStartRow + field.row - minimumCopiedRow,
        column: Math.min(field.column, COLUMN_COUNT - field.colSpan),
        props: {
          ...clonedField.props,
          defaultValueFormula: remapCopiedFormula(
            clonedField.props.defaultValueFormula,
            idMap,
          ),
        },
        parentGroupId: field.parentGroupId
          ? (idMap.get(field.parentGroupId) ?? null)
          : null,
      };
    });
    setFields((currentFields) => [...currentFields, ...pastedFields]);
    setSelectedFieldId(pastedFields[0]?.id ?? null);
    setInspectorFieldId(null);
  }

  function handleDrawerOpenChange(isOpen: boolean) {
    if (!isOpen) {
      setInspectorFieldId(null);
    }
  }

  function handleSave() {
    if (beforeDesignerActionRef.current && !beforeDesignerActionRef.current()) {
      return;
    }

    setSaveMessage("保存中...");

    void (async () => {
      try {
        const response = await fetch(`/api/forms/${formUuid}/schema/draft`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            schema: currentSchema,
            change_log: `draft saved at ${new Date().toISOString()}`,
          }),
        });
        const payload = (await response.json()) as {
          code: number;
          message: string;
          data: {
            version: number;
            latestVersion: number;
            publishedVersion: number;
          } | null;
        };

        if (payload.code === 0 && payload.data) {
          setLatestVersion(payload.data.latestVersion);
          setPublishedVersion(payload.data.publishedVersion);
          const versionsResponse = await fetch(`/api/forms/${formUuid}/versions`, {
            cache: "no-store",
          });
          const versionsPayload = (await versionsResponse.json()) as {
            code: number;
            data: FormVersionSummary[] | null;
          };
          if (versionsPayload.code === 0 && versionsPayload.data) {
            setVersions(versionsPayload.data.slice(0, 20));
          }
        }

        setSaveMessage(payload.code === 0 ? "已保存" : payload.message);
        if (payload.code === 0) {
          toast.success("草稿已保存", {
            description: `当前版本 v${payload.data?.latestVersion ?? latestVersion}`,
          });
        } else {
          toast.danger("保存失败", {
            description: payload.message,
          });
        }
      } catch {
        setSaveMessage("保存失败");
        toast.danger("保存失败", {
          description: "请稍后重试。",
        });
      }
    })();
  }

  function handlePublish() {
    if (beforeDesignerActionRef.current && !beforeDesignerActionRef.current()) {
      return;
    }

    setSaveMessage("发布中...");

    void (async () => {
      try {
        const response = await fetch(`/api/forms/${formUuid}/publish`, {
          method: "POST",
        });
        const payload = (await response.json()) as {
          code: number;
          message: string;
          data: {
            latestVersion: number;
            publishedVersion: number;
          } | null;
        };

        if (payload.code === 0 && payload.data) {
          setLatestVersion(payload.data.latestVersion);
          setPublishedVersion(payload.data.publishedVersion);
          const versionsResponse = await fetch(`/api/forms/${formUuid}/versions`, {
            cache: "no-store",
          });
          const versionsPayload = (await versionsResponse.json()) as {
            code: number;
            data: FormVersionSummary[] | null;
          };
          if (versionsPayload.code === 0 && versionsPayload.data) {
            setVersions(versionsPayload.data.slice(0, 20));
          }
        }

        setSaveMessage(payload.code === 0 ? "已发布" : payload.message);
        if (payload.code === 0) {
          toast.success("发布成功", {
            description: `已发布版本 v${payload.data?.publishedVersion ?? publishedVersion}`,
          });
        } else {
          toast.danger("发布失败", {
            description: payload.message,
          });
        }
      } catch {
        setSaveMessage("发布失败");
        toast.danger("发布失败", {
          description: "请稍后重试。",
        });
      }
    })();
  }

  function handleRestore(version: number) {
    setSaveMessage(`读取 v${version} 中...`);

    void (async () => {
      try {
        const response = await fetch(
          `/api/forms/${formUuid}/versions/${version}/restore`,
          {
            method: "POST",
          },
        );
        const payload = (await response.json()) as {
          code: number;
          message: string;
          data: {
            schema: FormDesignerSchema;
            latestVersion: number;
            publishedVersion: number;
          } | null;
        };

        if (payload.code === 0 && payload.data) {
          setFormName(payload.data.schema.formName || "New Page");
          setFields(
            (payload.data.schema.fields as PlacedField[]).map((field) => ({
              ...field,
              parentGroupId: field.parentGroupId ?? null,
            })),
          );
          setPageProps(normalizePageDesignerProps(payload.data.schema.pageProps));
          setLatestVersion(payload.data.latestVersion);
          setPublishedVersion(payload.data.publishedVersion);
        }

        setSaveMessage(payload.code === 0 ? `已读取 v${version}（未保存）` : payload.message);
        if (payload.code === 0) {
          toast.success("历史版本已载入", {
            description: `已读取 v${version}，保存后将生成新版本`,
          });
        } else {
          toast.danger("读取失败", {
            description: payload.message,
          });
        }
      } catch {
        setSaveMessage("读取失败");
        toast.danger("读取失败", {
          description: "请稍后重试。",
        });
      }
    })();
  }

  function handlePreview() {
    if (beforeDesignerActionRef.current && !beforeDesignerActionRef.current()) {
      return;
    }

    setIsPreviewOpen(true);
  }

  function handleBackToApp() {
    if (appId) {
      router.push(`/${appId}`);
      return;
    }

    router.push("/myApp");
  }

  function handleWorkbenchResizeStart(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    workbenchResizeStateRef.current = {
      startX: event.clientX,
      startWidth: workbenchWidth,
    };
  }

  return (
    <DndContext
      collisionDetection={designerCollisionDetection}
      sensors={sensors}
      onDragCancel={endDragging}
      onDragEnd={handleDesignerDragEnd}
      onDragStart={handleDesignerDragStart}
    >
      <div className="designer-theme-root h-screen min-h-screen overflow-hidden p-2">
      <div
        className="grid h-full min-h-0 gap-0"
        style={{
          gridTemplateColumns: `${workbenchWidth}px 16px minmax(0, 1fr)`,
        }}
      >
        <DesignerWorkbenchSidebar
          activePanel={activeDesignerPanel}
          debugEvents={debugEvents}
          fields={fields}
          pageProps={pageProps}
          schema={currentSchema}
          onActivePanelChange={setActiveDesignerPanel}
          onBeforeDesignerActionRegister={(handler) => {
            beforeDesignerActionRef.current = handler;
          }}
          onPagePropsChange={setPageProps}
        />

        <div className="flex items-center justify-center">
          <button
            type="button"
            aria-label="调整设计器侧栏宽度"
            className="group flex h-full w-4 cursor-col-resize items-center justify-center bg-transparent"
            onPointerDown={handleWorkbenchResizeStart}
          >
            <span className="h-full w-px rounded-full bg-[var(--color-border)] transition group-hover:w-[3px] group-hover:bg-[var(--color-primary)]" />
          </button>
        </div>

        <section className="flex min-h-0 min-w-0 flex-col">
          <FormDesignerHeader
            appName={appName}
            fieldsCount={fields.length}
            formName={formName}
            formUuid={formUuid}
            isEditingFormName={isEditingFormName}
            latestVersion={latestVersion}
            publishedVersion={publishedVersion}
            rowCount={rowCount}
            versions={versions}
            onBackToApp={handleBackToApp}
            onEditingFormNameChange={setIsEditingFormName}
            onFormNameChange={setFormName}
            onPreview={handlePreview}
            onPublish={handlePublish}
            onRestoreVersionSelect={handleRestore}
            onSave={handleSave}
            saveMessage={saveMessage}
          />

          <DesignerCanvas
            fields={fields}
            gridRef={gridRef}
            rowCount={rowCount}
            selectedFieldId={selectedFieldId}
            showMatrix={showMatrix}
            onCanvasClick={() => setSelectedFieldId(null)}
            onCanvasDoubleClick={openPageProperties}
            onFieldPropertiesOpen={openFieldProperties}
            onFieldSelect={selectField}
            onResizePointerDown={handleResizePointerDown}
            onResizePointerMove={handleResizePointerMove}
            onResizePointerUp={endResizing}
          />
        </section>
      </div>

      <FieldPropertyDrawer
        fields={fields}
        field={inspectorField}
        isOpen={inspectorField !== null}
        onDelete={removeField}
        onLabelChange={updateFieldLabel}
        onOpenChange={handleDrawerOpenChange}
        onPropsChange={updateFieldProps}
      />
      <PagePropertyDrawer
        isOpen={isPagePropertiesOpen}
        pageProps={pageProps}
        onOpenChange={setIsPagePropertiesOpen}
        onPropsChange={setPageProps}
      />
      <FormPreviewModal
        isOpen={isPreviewOpen}
        schema={currentSchema}
        onDebugEvent={(event) =>
          setDebugEvents((current) => [event, ...current].slice(0, 20))
        }
        onOpenChange={setIsPreviewOpen}
      />
      </div>
      <DragOverlay dropAnimation={null}>
        {activeDragData ? (
          <div className="pointer-events-none min-w-44 rounded-xl border border-[var(--color-primary)] bg-[var(--color-bg-surface)] px-4 py-3 text-sm font-semibold text-[var(--color-text-primary)] shadow-[var(--shadow-floating)]">
            {activeDragData.kind === "component"
              ? getDesignerComponent(activeDragData.componentType).label
              : fields.find((field) => field.id === activeDragData.fieldId)?.label ?? "表单组件"}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

const designerCollisionDetection: CollisionDetection = (args) => {
  const collisions = pointerWithin(args);
  const resolvedCollisions = collisions.length > 0 ? collisions : rectIntersection(args);

  return [...resolvedCollisions].sort((left, right) => {
    const leftIsGroupCell = String(left.id).startsWith("group-cell:");
    const rightIsGroupCell = String(right.id).startsWith("group-cell:");

    return Number(rightIsGroupCell) - Number(leftIsGroupCell);
  });
};

type DesignerSnapshot = {
  fields: PlacedField[];
  formName: string;
  pageProps: PageDesignerProps;
};

type DesignerHistory = {
  past: DesignerSnapshot[];
  present: DesignerSnapshot;
  future: DesignerSnapshot[];
};

function createDesignerSnapshot(
  formName: string,
  fields: PlacedField[],
  pageProps: PageDesignerProps,
): DesignerSnapshot {
  return {
    formName,
    fields: cloneFields(fields),
    pageProps: clonePageProps(pageProps),
  };
}

function cloneField(field: PlacedField): PlacedField {
  return JSON.parse(JSON.stringify(field)) as PlacedField;
}

function cloneFields(fields: PlacedField[]) {
  return fields.map(cloneField);
}

function clonePageProps(pageProps: PageDesignerProps) {
  return JSON.parse(JSON.stringify(pageProps)) as PageDesignerProps;
}

function areDesignerSnapshotsEqual(left: DesignerSnapshot, right: DesignerSnapshot) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getFieldSubtree(fields: PlacedField[], rootFieldId: string) {
  const result: PlacedField[] = [];
  const pendingIds = [rootFieldId];

  while (pendingIds.length > 0) {
    const currentId = pendingIds.shift()!;
    const field = fields.find((item) => item.id === currentId);
    if (!field) continue;
    result.push(field);
    pendingIds.push(
      ...fields
        .filter((item) => item.parentGroupId === currentId)
        .map((item) => item.id),
    );
  }

  return result;
}

function createPastedFieldId(type: PlacedField["type"]) {
  return `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function remapCopiedFormula(
  formula: string | undefined,
  idMap: Map<string, string>,
) {
  if (!formula) return formula;
  let result = formula;
  for (const [sourceId, targetId] of idMap) {
    result = result.replaceAll(
      `$${getFormulaFieldKey(sourceId)}`,
      `$${getFormulaFieldKey(targetId)}`,
    );
  }
  return result;
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"]',
    ),
  );
}
