"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, PointerEvent } from "react";
import {
  DndContext,
  DragOverlay,
  MeasuringFrequency,
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
  expandGroupToFit,
  getColumnStep,
  getInitialFieldLayout,
  getRowCount,
  isContainerFieldType,
  moveField,
  normalizeRichTextLayouts,
  planFieldInsertion,
  resizeField,
} from "./designer-layout";
import { buildSchema, normalizeDesignerFields } from "./designer-schema";
import type { FormDesignerSchema } from "./designer-schema";
import { getDefaultPageDesignerProps, normalizePageDesignerProps } from "./designer-schema";
import { validateDesignerSchema } from "./designer-validation";
import type {
  DesignerDragData,
  DesignerDropData,
  FormDesignerProps,
  PageDesignerProps,
  PlacedField,
  ResizeDirection,
  ResizeState,
} from "./designer-types";
import type { RuntimeDebugEvent } from "../../../../components/RuntimeFormRenderer";
import { getFormulaFieldKey } from "../../../../lib/form-formula";
import { FORM_COMPONENT_AGENT_CAPABILITIES_VERSION, getFormComponentAgentCapability } from "../../../../lib/form-component-agent-capabilities";
import { useAuth } from "../../../../components/AuthProvider";

const NO_EFFECTIVE_SCHEMA_CHANGE_MESSAGE = "当前设计没有做有效变更，不进行保存。";

export default function FormDesigner({ params }: FormDesignerProps) {
const DESIGNER_WORKBENCH_MIN_WIDTH = 300;
  const DESIGNER_WORKBENCH_MAX_WIDTH = 860;
  const { formUuid } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const appId = searchParams.get("appId");
  const { hasPermission } = useAuth();
  const canEditForm = Boolean(appId && hasPermission(`app:${appId}:edit_form`));
  const [appName, setAppName] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const resizeStateRef = useRef<ResizeState | null>(null);
  const resizeOriginFieldsRef = useRef<PlacedField[] | null>(null);
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
  const [formType, setFormType] = useState<"normal" | "workflow" | "defined">("normal");
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
  const [saveMessage, setSaveMessage] = useState("");
  const [latestVersion, setLatestVersion] = useState(1);
  const [currentVersion, setCurrentVersion] = useState(1);
  const [versions, setVersions] = useState<FormVersionSummary[]>([]);
  const [activeDesignerPanel, setActiveDesignerPanel] =
    useState<DesignerPanelKey>("components");
  const [debugEvents, setDebugEvents] = useState<RuntimeDebugEvent[]>([]);
  const [workbenchWidth, setWorkbenchWidth] = useState(DESIGNER_WORKBENCH_MIN_WIDTH);
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
        if (!cancelled && payload.code === 0 && (payload.data?.formType === "workflow" || payload.data?.formType === "defined")) {
          setFormType(payload.data.formType);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [formUuid]);

  useEffect(() => {
    if (dragOriginFieldsRef.current) return;

    if (isApplyingHistoryRef.current) {
      isApplyingHistoryRef.current = false;
      return;
    }

    if (!historyRef.current) {
      historyRef.current = {
        past: [],
        present: createDesignerSnapshot(formName, fields, pageProps),
        future: [],
      };
      return;
    }

    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = setTimeout(() => {
      commitDesignerSnapshot(createDesignerSnapshot(formName, fields, pageProps));
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
        const response = await fetch(`/api/forms/${formUuid}/schema`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          code: number;
          data: {
            schema: FormDesignerSchema;
            version: number;
            latestVersion: number;
          } | null;
          message: string;
        };

        if (cancelled || payload.code !== 0 || !payload.data?.schema) {
          return;
        }

        const nextSchema = payload.data.schema;
        const nextFields = normalizeDesignerFields(nextSchema.fields as PlacedField[]);
        const nextPageProps = normalizePageDesignerProps(nextSchema.pageProps);
        const nextFormName = nextSchema.formName || "New Page";
        resetDesignerHistory(nextFormName, nextFields, nextPageProps);
        setFormName(nextFormName);
        setFields(nextFields);
        setPageProps(nextPageProps);
        setLatestVersion(payload.data.latestVersion);
        setCurrentVersion(payload.data.version);
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
  }, []);

  function endDragging() {
    setIsDragging(false);
    setActiveDragData(null);
  }

  function endResizing() {
    const pendingResize = pendingResizeRef.current;
    const resizeState = resizeStateRef.current;
    const resizeOriginFields = resizeOriginFieldsRef.current;
    resizeStateRef.current = null;
    resizeOriginFieldsRef.current = null;
    pendingResizeRef.current = null;
    if (resizeFrameRef.current !== null) {
      cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = null;
    }
    if (pendingResize && resizeState) {
      setFields(() =>
        resizeField(
          resizeOriginFields ?? fields,
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

  function handleDesignerDragCancel() {
    dragOriginFieldsRef.current = null;
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

    endDragging();

    if (!dragData || !dropData || dropData.kind !== "cell") {
      setFields(originFields);
      return;
    }

    if (
      dragData.kind === "field" &&
      dropData.targetFieldId === dragData.fieldId
    ) {
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
        const draggedField = baseFields.find((field) => field.id === dragData.fieldId);
        const parentField = parentGroupId
          ? baseFields.find((field) => field.id === parentGroupId)
          : null;
        const expandedFields = expandGroupToFit(
          baseFields,
          parentField?.type === "groupContainer" ? parentField.id : null,
          row + (parentField?.type === "subform" ? 1 : (draggedField?.rowSpan ?? 1)),
        );
        return moveField(
          expandedFields,
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
      if (parentField?.type === "subform" && (isContainerFieldType(componentType) || componentType === "richText")) {
        if (componentType === "richText") {
          toast.danger("无法添加富文本", { description: "富文本不能添加到子表单。" });
        }
        return originFields;
      }
      if (componentType === "serialNumber") {
        const targetScope = parentField?.type === "subform" ? `subform:${parentField.id}` : "canvas";
        if (baseFields.some((field) => field.type === "serialNumber" && getSerialNumberScope(field, baseFields) === targetScope)) {
          toast.danger("无法添加流水号", {
            description: targetScope === "canvas" ? "主画布只能添加一个流水号组件。" : "每个子表单只能添加一个流水号组件。",
          });
          return originFields;
        }
      }
      const nextIndex =
        baseFields.filter((field) => field.type === componentType).length + 1;
      const defaultLayout = getInitialFieldLayout(componentType);
      const initialLayout = parentField?.type === "subform"
        ? { rowSpan: 1, colSpan: 1 }
        : componentType === "richText"
          ? { rowSpan: 1, colSpan: parentField?.type === "groupContainer" ? parentField.colSpan : COLUMN_COUNT }
        : componentType === "subform" && parentField?.type === "groupContainer"
          ? { rowSpan: 1, colSpan: parentField.colSpan }
          : defaultLayout;
      const targetColumn = componentType === "subform" || componentType === "richText"
        ? parentField?.type === "groupContainer" ? parentField.column : 0
        : column;
      const expandedFields = expandGroupToFit(
        baseFields,
        parentField?.type === "groupContainer" ? parentField.id : null,
        row + initialLayout.rowSpan,
      );

      if (
        !canPlaceField(
          expandedFields,
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

      return normalizeRichTextLayouts([
        ...expandedFields,
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
      ]);
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
    resizeOriginFieldsRef.current = cloneFields(fields);
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
      const resizeOriginFields = resizeOriginFieldsRef.current;
      if (!resizeOriginFields) return;
      setFields(() =>
        resizeField(
          resizeOriginFields,
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
        const response = await fetch(`/api/forms/${formUuid}/schema`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            schema: currentSchema,
            change_log: `saved at ${new Date().toISOString()}`,
            base_version: currentVersion,
          }),
        });
        const payload = (await response.json()) as {
          code: number;
          message: string;
          data: {
            version: number;
            latestVersion: number;
          } | null;
        };

        if (payload.code === 0 && payload.data) {
          setLatestVersion(payload.data.latestVersion);
          setCurrentVersion(payload.data.version);
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

        const hasEffectiveSchemaChange =
          payload.message !== NO_EFFECTIVE_SCHEMA_CHANGE_MESSAGE;
        setSaveMessage(
          payload.code === 0
            ? hasEffectiveSchemaChange ? "已保存" : NO_EFFECTIVE_SCHEMA_CHANGE_MESSAGE
            : payload.message,
        );
        if (payload.code === 0) {
          if (hasEffectiveSchemaChange) {
            toast.success("已保存", {
              description: `当前版本 v${payload.data?.latestVersion ?? latestVersion}`,
            });
          } else {
            toast.warning(NO_EFFECTIVE_SCHEMA_CHANGE_MESSAGE);
          }
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
          } | null;
        };

        if (payload.code === 0 && payload.data) {
          setFormName(payload.data.schema.formName || "New Page");
          setFields(normalizeDesignerFields(payload.data.schema.fields as PlacedField[]));
          setPageProps(normalizePageDesignerProps(payload.data.schema.pageProps));
          setLatestVersion(payload.data.latestVersion);
          setCurrentVersion(version);
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

    router.push("/");
  }

  async function handleWorkflowDesign() {
    if (!appId) return;
    try {
      const response = await fetch(`/api/apps/${appId}/automations`, { cache: "no-store" });
      const payload = await response.json() as { code: number; data?: { items?: Array<{ id: string; flowType?: string; triggerFormUuid?: string | null }> } };
      let workflow = payload.data?.items?.find((item) => item.flowType === "process" && item.triggerFormUuid === formUuid);
      if (!workflow) {
        const restoreResponse = await fetch(
          `/api/forms/${encodeURIComponent(formUuid)}/workflow/process`,
          { method: "POST" },
        );
        const restorePayload = await restoreResponse.json() as {
          code: number;
          data?: { id?: string };
        };
        if (!restoreResponse.ok || restorePayload.code !== 0 || !restorePayload.data?.id) {
          throw new Error("workflow automation restore failed");
        }
        workflow = { id: restorePayload.data.id };
        toast.success("已重新创建流程自动化");
      }
      router.push(`/${appId}/automations/${workflow.id}`);
    } catch {
      toast.danger("流程设计暂不可用", { description: "流程自动化恢复失败，请稍后重试。" });
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
    return <main className="grid h-full min-h-0 place-items-center p-6"><div className="max-w-md text-center"><h1 className="text-xl font-semibold text-[var(--color-text-primary)]">无表单开发权限</h1><p className="mt-2 ">请联系应用管理员授予“表单开发 - 编辑表单”权限。</p></div></main>;
  }

  return (
    <DndContext
      id={`form-designer-${formUuid}`}
      collisionDetection={designerCollisionDetection}
      measuring={DESIGNER_DROPPABLE_MEASURING}
      sensors={sensors}
      onDragCancel={handleDesignerDragCancel}
      onDragEnd={handleDesignerDragEnd}
      onDragStart={handleDesignerDragStart}
    >
      <div className={[
        "designer-theme-root h-dvh min-h-0 w-full max-w-full overflow-hidden",
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
          debugEvents={debugEvents}
          fields={fields}
          formType={formType}
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
          />
        </div>

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <FormDesignerHeader
            appName={appName}
            formName={formName}
            formType={formType}
            formUuid={formUuid}
            isEditingFormName={isEditingFormName}
            versions={versions}
            onBackToApp={handleBackToApp}
            onEditingFormNameChange={setIsEditingFormName}
            onFormNameChange={setFormName}
            onPreview={handlePreview}
            onRestoreVersionSelect={handleRestore}
            onSave={handleSave}
            onWorkflowDesign={formType === "workflow" ? () => void handleWorkflowDesign() : undefined}
            canEditForm={canEditForm}
            saveMessage={saveMessage}
          />

          <div className="flex min-h-0 min-w-0 flex-1 gap-2 overflow-hidden">
            <DesignerCanvas
              fields={fields}
              gridRef={gridRef}
              insertionIndicator={null}
              rowCount={rowCount}
              selectedFieldId={selectedFieldId}
              showMatrix={showMatrix}
              onCanvasClick={() => setSelectedFieldId(null)}
              onFieldSelect={selectField}
              onResizePointerDown={handleResizePointerDown}
              onResizePointerMove={handleResizePointerMove}
              onResizePointerUp={endResizing}
            />
            <Card className="h-full w-[300px] shrink-0 overflow-hidden p-0">
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
                  formType={formType}
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

function readAgentAnalysisDelta(frame: string) {
  let eventName = "message";
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?/)) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return "";
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(dataLines.join("")) as Record<string, unknown>; } catch { return ""; }
  if (eventName === "message.delta" && typeof payload.delta === "string") return payload.delta;
  // The current Agent Runtime forwards the canonical DSH envelope instead of
  // synthesizing legacy message.delta events. Extract text chunks from that
  // envelope for the schema-analysis consumer.
  if (eventName === "dsh.session.event" && payload.type === "assistant/chunk") {
    const chunk = payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>).chunk
      : undefined;
    if (chunk && typeof chunk === "object") {
      const value = chunk as Record<string, unknown>;
      return value.type === "text-delta" && typeof value.text === "string" ? value.text : "";
    }
  }
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
    // Dragging moves only the overlay. The grid itself stays still until drop.
    frequency: MeasuringFrequency.Optimized,
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
  const insertionDirection = candidates[0]?.direction ?? (
    dropData.allowRowInsertion === false
      ? relativeX < 0.5 ? "before-column" : "after-column"
      : relativeY < 0.5 ? "before-row" : "after-row"
  );

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
  return structuredClone(field);
}

function cloneFields(fields: PlacedField[]) {
  return fields.map(cloneField);
}

function clonePageProps(pageProps: PageDesignerProps) {
  return structuredClone(pageProps);
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

function getSerialNumberScope(field: PlacedField, fields: PlacedField[]) {
  const fieldsById = new Map(fields.map((item) => [item.id, item]));
  let parentId = field.parentGroupId;
  while (parentId) {
    const parent = fieldsById.get(parentId);
    if (!parent) break;
    if (parent.type === "subform") return `subform:${parent.id}`;
    parentId = parent.parentGroupId;
  }
  return "canvas";
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
