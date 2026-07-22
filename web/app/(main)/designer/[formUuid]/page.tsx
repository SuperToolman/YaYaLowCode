"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, PointerEvent } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Card, toast } from "@heroui/react";
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
import { FieldPropertyPanel } from "./components/field-properties/FieldPropertyDrawer";
import { FormPreviewModal } from "./components/FormPreviewModal";
import { FormDesignerHeader } from "./components/FormDesignerHeader";
import type { FormVersionSummary } from "./components/FormDesignerHeader";
import { PagePropertyPanel } from "./components/page-properties/PagePropertyDrawer";
import { CELL_MIN_HEIGHT, COLUMN_COUNT, GRID_ROW_GAP } from "./designer-constants";
import {
  canPlaceField,
  getColumnStep,
  getInitialFieldLayout,
  getRowCount,
  isContainerFieldType,
  moveField,
  planFieldInsertion,
  resizeField,
} from "./designer-layout";
import { buildSchema } from "./designer-schema";
import type { FormDesignerSchema } from "./designer-schema";
import { getDefaultPageDesignerProps, normalizePageDesignerProps } from "./designer-schema";
import { validateDesignerSchema } from "./designer-validation";
import type {
  DesignerDragData,
  DesignerDropData,
  DesignerInsertionIndicator,
  FormDesignerProps,
  PageDesignerProps,
  PlacedField,
  ResizeDirection,
  ResizeState,
} from "./designer-types";
import type { RuntimeDebugEvent } from "../../../components/runtime-form-renderer";
import { getFormulaFieldKey } from "../../../lib/form-formula";
import { FORM_COMPONENT_AGENT_CAPABILITIES_VERSION, getFormComponentAgentCapability } from "../../../lib/form-component-agent-capabilities";
import { useAuth } from "../../../components/auth-provider";

export default function FormDesigner({ params }: FormDesignerProps) {
  const DESIGNER_WORKBENCH_MIN_WIDTH = 300;
  const DESIGNER_WORKBENCH_MAX_WIDTH = 860;
  const { formUuid } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const appId = searchParams.get("appId");
  const { hasPermission } = useAuth();
  const canEditForm = Boolean(appId && hasPermission(`app:${appId}:edit_form`));
  const canPublish = canEditForm && Boolean(appId && hasPermission(`app:${appId}:publish`));
  const [appName, setAppName] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const resizeStateRef = useRef<ResizeState | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const pendingResizeRef = useRef<{ deltaColumns: number; deltaRows: number } | null>(null);
  const beforeDesignerActionRef = useRef<(() => boolean) | null>(null);
  const workbenchResizeStateRef = useRef<{
    startX: number;
    startWidth: number;
  } | null>(null);
  const workbenchResizeFrameRef = useRef<number | null>(null);
  const pendingWorkbenchWidthRef = useRef<number | null>(null);
  const [formName, setFormName] = useState("New Page");
  const [formType, setFormType] = useState<"normal" | "workflow">("normal");
  const [isEditingFormName, setIsEditingFormName] = useState(false);
  const [fields, setFields] = useState<PlacedField[]>([]);
  const [pageProps, setPageProps] = useState<PageDesignerProps>(() =>
    getDefaultPageDesignerProps(),
  );
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);

  const rowCount = useMemo(() => getRowCount(fields), [fields]);
  const showMatrix = isDragging || isResizing;
  const currentSchema = useMemo(
    () => buildSchema(formUuid, formName, fields, pageProps),
    [fields, formName, formUuid, pageProps],
  );
  const selectedField = useMemo(
    () => fields.find((field) => field.id === selectedFieldId) ?? null,
    [fields, selectedFieldId],
  );
  const agentAnalysisSourceHash = useMemo(
    () => getAgentAnalysisSourceHash(currentSchema),
    [currentSchema],
  );
  const [saveMessage, setSaveMessage] = useState("");
  const [latestVersion, setLatestVersion] = useState(1);
  const [publishedVersion, setPublishedVersion] = useState(1);
  const [versions, setVersions] = useState<FormVersionSummary[]>([]);
  const [activeDesignerPanel, setActiveDesignerPanel] =
    useState<DesignerPanelKey>("components");
  const [debugEvents, setDebugEvents] = useState<RuntimeDebugEvent[]>([]);
  const [isAnalyzingAgent, setIsAnalyzingAgent] = useState(false);
  const [workbenchWidth, setWorkbenchWidth] = useState(DESIGNER_WORKBENCH_MIN_WIDTH);
  const [activeDragData, setActiveDragData] = useState<DesignerDragData | null>(null);
  const [insertionIndicator, setInsertionIndicator] =
    useState<DesignerInsertionIndicator | null>(null);
  const insertionIndicatorFrameRef = useRef<number | null>(null);
  const pendingInsertionIndicatorRef = useRef<DesignerInsertionIndicator | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  const historyRef = useRef<DesignerHistory | null>(null);
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isApplyingHistoryRef = useRef(false);
  const copiedFieldsRef = useRef<PlacedField[]>([]);
  const dragOriginFieldsRef = useRef<PlacedField[] | null>(null);

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
    let cancelled = false;

    void fetch(`/api/forms/${formUuid}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { code: number; data: { formType?: string } | null }) => {
        if (!cancelled && payload.code === 0 && payload.data?.formType === "workflow") {
          setFormType("workflow");
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [formUuid]);

  useEffect(() => {
    if (dragOriginFieldsRef.current) return;

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
      pendingWorkbenchWidthRef.current = Math.max(
        DESIGNER_WORKBENCH_MIN_WIDTH,
        Math.min(DESIGNER_WORKBENCH_MAX_WIDTH, nextWidth),
      );
      if (workbenchResizeFrameRef.current !== null) return;

      workbenchResizeFrameRef.current = requestAnimationFrame(() => {
        workbenchResizeFrameRef.current = null;
        const pendingWidth = pendingWorkbenchWidthRef.current;
        pendingWorkbenchWidthRef.current = null;
        if (pendingWidth !== null) setWorkbenchWidth(pendingWidth);
      });
    }

    function handlePointerUp() {
      workbenchResizeStateRef.current = null;
      const pendingWidth = pendingWorkbenchWidthRef.current;
      pendingWorkbenchWidthRef.current = null;
      if (workbenchResizeFrameRef.current !== null) {
        cancelAnimationFrame(workbenchResizeFrameRef.current);
        workbenchResizeFrameRef.current = null;
      }
      if (pendingWidth !== null) setWorkbenchWidth(pendingWidth);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  useEffect(() => () => {
    if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
    if (workbenchResizeFrameRef.current !== null) {
      cancelAnimationFrame(workbenchResizeFrameRef.current);
    }
    if (insertionIndicatorFrameRef.current !== null) {
      cancelAnimationFrame(insertionIndicatorFrameRef.current);
    }
  }, []);

  function endDragging() {
    if (insertionIndicatorFrameRef.current !== null) {
      cancelAnimationFrame(insertionIndicatorFrameRef.current);
      insertionIndicatorFrameRef.current = null;
    }
    pendingInsertionIndicatorRef.current = null;
    setIsDragging(false);
    setActiveDragData(null);
  }

  function endResizing() {
    const pendingResize = pendingResizeRef.current;
    const resizeState = resizeStateRef.current;
    resizeStateRef.current = null;
    pendingResizeRef.current = null;
    if (resizeFrameRef.current !== null) {
      cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = null;
    }
    if (pendingResize && resizeState) {
      setFields((currentFields) =>
        resizeField(
          currentFields,
          resizeState,
          pendingResize.deltaRows,
          pendingResize.deltaColumns,
        ),
      );
    }
    setIsResizing(false);
  }

  function handleDesignerDragStart(event: DragStartEvent) {
    const dragData = event.active.data.current as DesignerDragData | undefined;

    if (!dragData || (dragData.kind !== "component" && dragData.kind !== "field")) {
      return;
    }

    flushDesignerHistory();
    dragOriginFieldsRef.current = cloneFields(fields);
    setInsertionIndicator(null);
    setActiveDragData(dragData);
    setIsDragging(true);
    setSelectedFieldId(null);
  }

  function createInsertionPlan(
    sourceFields: PlacedField[],
    dragData: DesignerDragData,
    dropData: DesignerDropData,
  ) {
    if (!dropData.insertionDirection || !dropData.targetFieldId) return null;

    const incoming = dragData.kind === "field"
      ? sourceFields.find((field) => field.id === dragData.fieldId)
      : null;
    if (dragData.kind === "field" && !incoming) return null;
    const defaultLayout = dragData.kind === "component"
      ? getInitialFieldLayout(dragData.componentType)
      : null;

    return planFieldInsertion(
      sourceFields,
      {
        fieldId: dragData.kind === "field" ? dragData.fieldId : null,
        type: dragData.kind === "field" ? incoming!.type : dragData.componentType,
        rowSpan: dragData.kind === "field" ? incoming!.rowSpan : defaultLayout!.rowSpan,
        colSpan: dragData.kind === "field" ? incoming!.colSpan : defaultLayout!.colSpan,
      },
      dropData.targetFieldId,
      dropData.insertionDirection,
    );
  }

  function handleDesignerDragOver(event: DragOverEvent) {
    const originFields = dragOriginFieldsRef.current;
    const dragData = event.active.data.current as DesignerDragData | undefined;
    const rawDropData = event.over?.data.current as DesignerDropData | undefined;
    const dropData = resolvePointerInsertionDirection(event, rawDropData);
    if (!originFields || !dragData || !dropData || dropData.kind !== "cell") {
      setInsertionIndicator(null);
      return;
    }

    const nextIndicator: DesignerInsertionIndicator | null =
      dropData.insertionDirection && dropData.targetFieldId
        ? {
            kind: "edge",
            fieldId: dropData.targetFieldId,
            direction: dropData.insertionDirection,
          }
        : null;
    pendingInsertionIndicatorRef.current = nextIndicator;
    if (insertionIndicatorFrameRef.current !== null) return;

    insertionIndicatorFrameRef.current = requestAnimationFrame(() => {
      insertionIndicatorFrameRef.current = null;
      const pendingIndicator = pendingInsertionIndicatorRef.current;
      pendingInsertionIndicatorRef.current = null;
      setInsertionIndicator((current) =>
        current?.fieldId === pendingIndicator?.fieldId &&
        current?.direction === pendingIndicator?.direction
          ? current
          : pendingIndicator,
      );
    });
  }

  function handleDesignerDragCancel() {
    dragOriginFieldsRef.current = null;
    setInsertionIndicator(null);
    endDragging();
  }

  function handleDesignerDragEnd(event: DragEndEvent) {
    const dragData = event.active.data.current as DesignerDragData | undefined;
    const rawDropData = event.over?.data.current as DesignerDropData | undefined;
    const dropData = resolvePointerInsertionDirection(event, rawDropData);
    const originFields = dragOriginFieldsRef.current ?? fields;
    const insertionPlan = dragData && dropData?.insertionDirection
      ? createInsertionPlan(originFields, dragData, dropData)
      : null;

    const attemptedInsertion = Boolean(dropData?.insertionDirection);
    dragOriginFieldsRef.current = null;
    setInsertionIndicator(null);

    endDragging();

    if (!dragData || !dropData || dropData.kind !== "cell") {
      setFields(originFields);
      return;
    }

    if (attemptedInsertion && !insertionPlan?.valid) {
      setFields(originFields);
      toast.danger("无法插入组件", {
        description: insertionPlan?.reason ?? "当前位置无法完成自动重排。",
      });
      return;
    }

    const placement = insertionPlan?.valid ? insertionPlan.target : dropData;
    const baseFields = insertionPlan?.valid ? insertionPlan.fields : originFields;
    const { column, parentGroupId, row } = placement;

    setFields(() => {
      if (dragData.kind === "field") {
        return moveField(
          baseFields,
          dragData.fieldId,
          row,
          column,
          parentGroupId,
        );
      }

      const componentType = dragData.componentType;
      const component = getDesignerComponent(componentType);
      const parentField = parentGroupId
        ? baseFields.find((field) => field.id === parentGroupId)
        : null;
      if (parentField?.type === "subform" && isContainerFieldType(componentType)) {
        return originFields;
      }
      const nextIndex =
        baseFields.filter((field) => field.type === componentType).length + 1;
      const defaultLayout = getInitialFieldLayout(componentType);
      const initialLayout = parentField?.type === "subform"
        ? { rowSpan: 1, colSpan: 1 }
        : componentType === "subform" && parentField?.type === "groupContainer"
          ? { rowSpan: 1, colSpan: parentField.colSpan }
          : defaultLayout;
      const targetColumn = componentType === "subform"
        ? parentField?.type === "groupContainer" ? parentField.column : 0
        : column;

      if (
        !canPlaceField(
          baseFields,
          null,
          row,
          targetColumn,
          initialLayout.rowSpan,
          initialLayout.colSpan,
          parentGroupId,
        )
      ) {
        return originFields;
      }

      return [
        ...baseFields,
        {
          id: `${componentType}-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,
          type: componentType,
          label: `${component.label}${nextIndex}`,
          row,
          column: targetColumn,
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

    pendingResizeRef.current = { deltaColumns, deltaRows };
    if (resizeFrameRef.current !== null) return;

    resizeFrameRef.current = requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      const pendingResize = pendingResizeRef.current;
      const activeResizeState = resizeStateRef.current;
      pendingResizeRef.current = null;
      if (!pendingResize || !activeResizeState) return;
      setFields((currentFields) =>
        resizeField(
          currentFields,
          activeResizeState,
          pendingResize.deltaRows,
          pendingResize.deltaColumns,
        ),
      );
    });
  }

  function selectField(event: MouseEvent<HTMLDivElement>, fieldId: string) {
    event.stopPropagation();
    setSelectedFieldId(fieldId);
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
    const removedIds = new Set(getFieldSubtree(fields, fieldId).map((field) => field.id));
    setFields((currentFields) => currentFields.filter((field) => !removedIds.has(field.id)));
    setPageProps((current) => ({
      ...current,
      indexedFieldIds: current.indexedFieldIds.filter((id) => !removedIds.has(id)),
    }));
    setSelectedFieldId(null);
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
        column: field.parentGroupId
          ? field.column
          : Math.min(field.column, COLUMN_COUNT - field.colSpan),
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
  }

  function validateBeforePersist() {
    if (beforeDesignerActionRef.current && !beforeDesignerActionRef.current()) {
      return false;
    }

    const issues = validateDesignerSchema(fields);
    if (issues.length === 0) return true;

    setSelectedFieldId(issues[0].fieldId);
    toast.danger("Schema 校验失败", {
      description: issues.length === 1
        ? issues[0].message
        : `${issues[0].message}，另有 ${issues.length - 1} 个空容器`,
    });
    return false;
  }

  function handleSave() {
    if (!validateBeforePersist()) return;

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

  async function handleAnalyzeAgentSchema() {
    if (!pageProps.agent.enabled) return;
    if (!pageProps.agent.agentId) {
      toast.danger("无法分析 Schema", { description: "请先在 Agent 工具中选择机器人。" });
      return;
    }

    const sourceHash = getAgentAnalysisSourceHash(currentSchema);
    setIsAnalyzingAgent(true);
    setPageProps((current) => ({
      ...current,
      agent: {
        ...current.agent,
        context: { ...current.agent.context, status: "analyzing", error: "" },
      },
    }));
    try {
      const generated = await analyzeSchemaBeforePublish({
        agentId: pageProps.agent.agentId,
        appId,
        formUuid,
        prompt: pageProps.agent.prompt,
        schema: currentSchema,
      });
      setPageProps((current) => ({
        ...current,
        agent: {
          ...current.agent,
          context: {
            ...current.agent.context,
            generated,
            overrides: "",
            generatedAt: new Date().toISOString(),
            sourceHash,
            status: "ready",
            error: "",
          },
        },
      }));
      toast.success("Schema 分析完成", { description: "分析结果已写入当前设计草稿，请保存后发布。" });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Schema 分析失败";
      setPageProps((current) => ({
        ...current,
        agent: {
          ...current.agent,
          context: { ...current.agent.context, status: "failed", error: message },
        },
      }));
      toast.danger("Schema 分析失败", { description: message });
    } finally {
      setIsAnalyzingAgent(false);
    }
  }

  function handlePublish() {
    if (!validateBeforePersist()) return;

    setSaveMessage("发布中...");

    void (async () => {
      try {
        if (pageProps.agent.enabled && !pageProps.agent.agentId) throw new Error("请先在 Agent 工具中选择机器人");
        const currentAnalysisHash = getAgentAnalysisSourceHash(currentSchema);
        const analysisIsFresh = pageProps.agent.context.status === "ready" && pageProps.agent.context.sourceHash === currentAnalysisHash;
        const publishPageProps: PageDesignerProps = pageProps.agent.enabled && !analysisIsFresh
          ? { ...pageProps, agent: { ...pageProps.agent, context: { ...pageProps.agent.context, status: "stale" } } }
          : pageProps;
        if (publishPageProps !== pageProps) setPageProps(publishPageProps);
        const schemaToPublish = buildSchema(formUuid, formName, fields, publishPageProps);

        setSaveMessage("正在保存发布版本...");
        const draftResponse = await fetch(`/api/forms/${formUuid}/schema/draft`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            schema: schemaToPublish,
            change_log: `publish draft prepared at ${new Date().toISOString()}`,
          }),
        });
        const draftPayload = (await draftResponse.json()) as {
          code: number;
          message: string;
          data: { latestVersion: number; publishedVersion: number } | null;
        };
        if (!draftResponse.ok || draftPayload.code !== 0 || !draftPayload.data) {
          throw new Error(draftPayload.message || "保存发布版本失败");
        }

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
      } catch (reason) {
        setSaveMessage("发布失败");
        toast.danger("发布失败", {
          description: reason instanceof Error ? reason.message : "请稍后重试。",
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

  async function handleWorkflowDesign() {
    if (!appId) return;
    try {
      const response = await fetch(`/api/apps/${appId}/automations`, { cache: "no-store" });
      const payload = await response.json() as { code: number; data?: { items?: Array<{ id: string; flowType?: string; triggerFormUuid?: string | null }> } };
      const workflow = payload.data?.items?.find((item) => item.flowType === "process" && item.triggerFormUuid === formUuid);
      if (!workflow) throw new Error("workflow automation not found");
      router.push(`/${appId}/automations/${workflow.id}`);
    } catch {
      toast.danger("流程设计暂不可用", { description: "未找到当前流程表单绑定的流程自动化。" });
    }
  }

  function handleWorkbenchResizeStart(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    workbenchResizeStateRef.current = {
      startX: event.clientX,
      startWidth: workbenchWidth,
    };
  }

  if (appId && !canEditForm) {
    return <main className="grid h-full min-h-0 place-items-center p-6"><div className="max-w-md text-center"><h1 className="text-xl font-semibold text-[var(--color-text-primary)]">无表单开发权限</h1><p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">请联系应用管理员授予“表单开发 - 编辑表单”权限。</p></div></main>;
  }

  return (
    <DndContext
      id={`form-designer-${formUuid}`}
      collisionDetection={designerCollisionDetection}
      measuring={DESIGNER_DROPPABLE_MEASURING}
      sensors={sensors}
      onDragCancel={handleDesignerDragCancel}
      onDragEnd={handleDesignerDragEnd}
      onDragOver={handleDesignerDragOver}
      onDragStart={handleDesignerDragStart}
    >
      <div className={[
        "designer-theme-root h-dvh min-h-0 w-full max-w-full overflow-hidden p-1",
        showMatrix ? "designer-is-interacting" : "",
      ].join(" ")}>
      <div
        className="grid h-full min-h-0 w-full max-w-full gap-0 overflow-hidden"
        style={{
          gridTemplateColumns: `${workbenchWidth}px 16px minmax(0, 1fr)`,
        }}
      >
        <DesignerWorkbenchSidebar
          activePanel={activeDesignerPanel}
          agentAnalysisStale={pageProps.agent.enabled && pageProps.agent.context.sourceHash !== agentAnalysisSourceHash}
          debugEvents={debugEvents}
          fields={fields}
          pageProps={pageProps}
          schema={currentSchema}
          onActivePanelChange={setActiveDesignerPanel}
          isAnalyzingAgent={isAnalyzingAgent}
          onAnalyzeAgentSchema={() => void handleAnalyzeAgentSchema()}
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

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <FormDesignerHeader
            appName={appName}
            fieldsCount={fields.length}
            formName={formName}
            formType={formType}
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
            onWorkflowDesign={formType === "workflow" ? () => void handleWorkflowDesign() : undefined}
            canEditForm={canEditForm}
            canPublish={canPublish}
            saveMessage={saveMessage}
          />

          <div className="flex min-h-0 min-w-0 flex-1 gap-2 overflow-hidden">
            <DesignerCanvas
              fields={fields}
              gridRef={gridRef}
              insertionIndicator={insertionIndicator}
              rowCount={rowCount}
              selectedFieldId={selectedFieldId}
              showMatrix={showMatrix}
              onCanvasClick={() => setSelectedFieldId(null)}
              onFieldSelect={selectField}
              onResizePointerDown={handleResizePointerDown}
              onResizePointerMove={handleResizePointerMove}
              onResizePointerUp={endResizing}
            />
            <Card className="h-full w-[300px] shrink-0 overflow-hidden rounded-lg border border-[var(--designer-border)] bg-[var(--designer-surface-solid)] p-0 shadow-none">
              {selectedField ? (
                <FieldPropertyPanel
                  fields={fields}
                  field={selectedField}
                  onDelete={removeField}
                  onLabelChange={updateFieldLabel}
                  onPropsChange={updateFieldProps}
                />
              ) : (
                <PagePropertyPanel
                  formName={formName}
                  pageProps={pageProps}
                  onPropsChange={setPageProps}
                />
              )}
            </Card>
          </div>
        </section>
      </div>
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

function getAgentAnalysisSourceHash(schema: FormDesignerSchema) {
  const source = JSON.stringify({
    formName: schema.formName,
    columns: schema.columns,
    rows: schema.rows,
    fields: schema.fields,
    capabilitiesVersion: FORM_COMPONENT_AGENT_CAPABILITIES_VERSION,
    agentId: schema.pageProps.agent.agentId,
    prompt: schema.pageProps.agent.prompt,
  });
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

async function analyzeSchemaBeforePublish({ agentId, appId, formUuid, prompt, schema }: { agentId: string; appId: string | null; formUuid: string; prompt: string; schema: FormDesignerSchema }) {
  const context = { appId: appId ?? undefined, formUuid, route: `/designer/${formUuid}` };
  const sessionResponse = await fetch("/api/agent/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId, context }),
  });
  const sessionPayload = (await sessionResponse.json()) as { code: number; message: string; data: { id: string } | null };
  if (!sessionResponse.ok || sessionPayload.code !== 0 || !sessionPayload.data) {
    throw new Error(sessionPayload.message || "无法创建 Schema 分析会话");
  }

  const schemaForAnalysis = {
    ...schema,
    fields: schema.fields.map((field) => ({
      ...field,
      agentCapability: getFormComponentAgentCapability(field.type),
    })),
    pageProps: {
      ...schema.pageProps,
      agent: {
        enabled: schema.pageProps.agent.enabled,
        agentId: schema.pageProps.agent.agentId,
        prompt: schema.pageProps.agent.prompt,
      },
    },
  };
  const analysisPrompt = [
    "分析下面的低代码表单 Schema，为运行时表单 Agent 生成简洁、可复用的业务上下文。只输出最终分析结果，不要描述分析过程。",
    prompt.trim() ? `设计者提供的业务提示：${prompt.trim()}` : "",
    [
      "输出规则：",
      "- 使用紧凑 Markdown，只允许必要的小标题、表格和列表。",
      "- 不要输出寒暄、前言、总结、主观意见、改进建议或工具调用过程。",
      "- 不要出现“我来获取”“现在我已拥有完整上下文”“开始生成分析报告”“以下是”等过程性或口语化句子。",
      "- 不要重复 Schema 原文，不要使用连续空行，每个段落只保留必要换行。",
      "- 只陈述能从 Schema 和设计者提示中确认的事实；不确定内容明确标记为“需询问”。",
      "- 字段必须同时标注 label 和 fieldId；相同类型规则尽量合并表达。",
      "- 内容结构限定为：业务目的、字段与约束、Agent 填写策略、关联规则。没有内容的章节省略。",
    ].join("\n"),
    `Schema：${JSON.stringify(schemaForAnalysis)}`,
  ].filter(Boolean).join("\n\n");
  const response = await fetch(`/api/agent/sessions/${encodeURIComponent(sessionPayload.data.id)}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({ content: analysisPrompt, context }),
  });
  if (!response.ok || !response.body) {
    const payload = (await response.json()) as { message?: string };
    throw new Error(payload.message || "Schema 分析失败");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) result += readAgentAnalysisDelta(frame);
    if (done) {
      if (buffer.trim()) result += readAgentAnalysisDelta(buffer);
      break;
    }
  }
  const normalizedResult = normalizeAgentSchemaAnalysis(result);
  if (!normalizedResult) throw new Error("机器人未生成有效的 Schema 分析结果");
  return normalizedResult;
}

function normalizeAgentSchemaAnalysis(content: string) {
  const narrationPatterns = [
    /^(好的|当然|没问题)[，。！!]?/,
    /^(我来|接下来我将|现在我已|现在开始|开始生成|以下是|下面是)/,
    /(获取该应用下的其他表单|拥有完整的上下文|为分析提供更完整的上下文)/,
  ];
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => !narrationPatterns.some((pattern) => pattern.test(line.trim())))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function readAgentAnalysisDelta(frame: string) {
  let eventName = "message";
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return "";
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(dataLines.join("\n")) as Record<string, unknown>; } catch { return ""; }
  if (eventName === "message.delta" && typeof payload.delta === "string") return payload.delta;
  if (eventName === "run.failed") throw new Error(typeof payload.message === "string" ? payload.message : "Schema 分析失败");
  return "";
}

const designerCollisionDetection: CollisionDetection = (args) => {
  const collisions = pointerWithin(args);
  if (collisions.length < 2) return collisions;

  const nestedCell = collisions.find((collision) => {
    const id = String(collision.id);
    return id.startsWith("group-cell:") || id.startsWith("subform-cell:");
  });
  return nestedCell ? [nestedCell] : [collisions[0]];
};

const DESIGNER_DROPPABLE_MEASURING = {
  droppable: {
    // Pointer movement does not change grid geometry. Sampling measurements at
    // 80ms keeps nested drop zones accurate without synchronously measuring
    // every cell on every pointer event.
    frequency: 80,
  },
};

function resolvePointerInsertionDirection(
  event: DragOverEvent | DragEndEvent,
  dropData?: DesignerDropData,
): DesignerDropData | undefined {
  if (!dropData?.targetFieldId || !event.over) return dropData;
  const activatorEvent = event.activatorEvent as Event & {
    clientX?: number;
    clientY?: number;
  };
  if (
    typeof activatorEvent.clientX !== "number" ||
    typeof activatorEvent.clientY !== "number"
  ) {
    return { ...dropData, insertionDirection: undefined };
  }

  const rect = event.over.rect;
  const pointerX = activatorEvent.clientX + event.delta.x;
  const pointerY = activatorEvent.clientY + event.delta.y;
  const relativeX = (pointerX - rect.left) / Math.max(rect.width, 1);
  const relativeY = (pointerY - rect.top) / Math.max(rect.height, 1);
  const topThreshold = 0.09;
  const bottomThreshold = 0.09;
  const leftThreshold = 0.08;
  const rightThreshold = 0.08;
  const candidates: Array<{
    direction: NonNullable<DesignerDropData["insertionDirection"]>;
    distance: number;
  }> = [];
  if (dropData.allowRowInsertion !== false && relativeY >= 0 && relativeY <= topThreshold) {
    candidates.push({ direction: "before-row", distance: relativeY / topThreshold });
  }
  if (dropData.allowRowInsertion !== false && relativeY <= 1 && relativeY >= 1 - bottomThreshold) {
    candidates.push({ direction: "after-row", distance: (1 - relativeY) / bottomThreshold });
  }
  if (relativeX >= 0 && relativeX <= leftThreshold) {
    candidates.push({ direction: "before-column", distance: relativeX / leftThreshold });
  }
  if (relativeX <= 1 && relativeX >= 1 - rightThreshold) {
    candidates.push({ direction: "after-column", distance: (1 - relativeX) / rightThreshold });
  }
  candidates.sort((left, right) => left.distance - right.distance);
  const insertionDirection = candidates[0]?.direction;

  return { ...dropData, insertionDirection };
}

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
