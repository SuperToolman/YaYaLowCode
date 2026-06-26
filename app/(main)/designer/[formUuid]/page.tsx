"use client";

import { use, useEffect, useRef, useState } from "react";
import type { DragEvent, MouseEvent, PointerEvent } from "react";
import { toast } from "@heroui/react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  COMPONENT_DRAG_TYPE,
  PLACED_FIELD_DRAG_TYPE,
  getDefaultDesignerFieldProps,
  getDesignerComponent,
  isDesignerComponentType,
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
import { CELL_MIN_HEIGHT, GRID_ROW_GAP } from "./designer-constants";
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
  ActiveCell,
  FormDesignerProps,
  PageDesignerProps,
  PlacedField,
  ResizeDirection,
  ResizeState,
} from "./designer-types";
import type { RuntimeDebugEvent } from "../../../components/runtime-form-renderer";

export default function FormDesigner({ params }: FormDesignerProps) {
  const DESIGNER_WORKBENCH_MIN_WIDTH = 360;
  const DESIGNER_WORKBENCH_MAX_WIDTH = 860;
  const { formUuid } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const appId = searchParams.get("appId");
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
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null);
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
        setFormName(nextSchema.formName || "New Page");
        setFields(
          (nextSchema.fields as PlacedField[]).map((field) => ({
            ...field,
            parentGroupId: field.parentGroupId ?? null,
          })),
        );
        setPageProps(normalizePageDesignerProps(nextSchema.pageProps));
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
          setVersions(payload.data);
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
    setActiveCell(null);
  }

  function endResizing() {
    resizeStateRef.current = null;
    setIsResizing(false);
    setActiveCell(null);
  }

  function handleDrop(
    event: DragEvent<HTMLDivElement>,
    row: number,
    column: number,
  ) {
    event.preventDefault();
    endDragging();
    setSelectedFieldId(null);
    setInspectorFieldId(null);

    const draggedFieldId = event.dataTransfer.getData(PLACED_FIELD_DRAG_TYPE);
    const componentType = event.dataTransfer.getData(COMPONENT_DRAG_TYPE);

    setFields((currentFields) => {
      if (draggedFieldId) {
        return moveField(currentFields, draggedFieldId, row, column, null);
      }

      if (!isDesignerComponentType(componentType)) {
        return currentFields;
      }

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
          parentGroupId: null,
        },
      ];
    });
  }

  function handleDropToGroup(
    event: DragEvent<HTMLDivElement>,
    groupId: string,
    row: number,
    column: number,
  ) {
    event.preventDefault();
    endDragging();
    const draggedFieldId = event.dataTransfer.getData(PLACED_FIELD_DRAG_TYPE);
    const componentType = event.dataTransfer.getData(COMPONENT_DRAG_TYPE);

    setFields((currentFields) => {
      if (draggedFieldId) {
        return moveField(currentFields, draggedFieldId, row, column, groupId);
      }

      if (!isDesignerComponentType(componentType)) {
        return currentFields;
      }

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
          groupId,
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
          parentGroupId: groupId,
        },
      ];
    });
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = hasDragType(
      event,
      PLACED_FIELD_DRAG_TYPE,
    )
      ? "move"
      : "copy";
  }

  function handlePlacedFieldDragStart(
    event: DragEvent<HTMLDivElement>,
    fieldId: string,
  ) {
    setIsDragging(true);
    setSelectedFieldId(null);
    setInspectorFieldId(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(PLACED_FIELD_DRAG_TYPE, fieldId);
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
    setFields((currentFields) =>
      currentFields.filter((field) => field.id !== fieldId),
    );
    setSelectedFieldId(null);
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
            setVersions(versionsPayload.data);
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
            setVersions(versionsPayload.data);
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
    setSaveMessage(`恢复 v${version} 中...`);

    void (async () => {
      try {
        const response = await fetch(
          `/api/forms/${formUuid}/versions/${version}/restore`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              change_log: `restore from v${version}`,
            }),
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
          const versionsResponse = await fetch(`/api/forms/${formUuid}/versions`, {
            cache: "no-store",
          });
          const versionsPayload = (await versionsResponse.json()) as {
            code: number;
            data: FormVersionSummary[] | null;
          };
          if (versionsPayload.code === 0 && versionsPayload.data) {
            setVersions(versionsPayload.data);
          }
        }

        setSaveMessage(payload.code === 0 ? "已恢复版本" : payload.message);
        if (payload.code === 0) {
          toast.success("版本已恢复", {
            description: `已恢复到 v${version}`,
          });
        } else {
          toast.danger("恢复失败", {
            description: payload.message,
          });
        }
      } catch {
        setSaveMessage("恢复失败");
        toast.danger("恢复失败", {
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
    <div className="h-screen min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,#dfeeff_0,#f5f8fc_34%,#eef4fb_100%)] p-6 text-[#14213d]">
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
          onComponentDragEnd={endDragging}
          onComponentDragStart={() => setIsDragging(true)}
          onPagePropsChange={setPageProps}
        />

        <div className="flex items-center justify-center">
          <button
            type="button"
            aria-label="调整设计器侧栏宽度"
            className="group flex h-full w-4 cursor-col-resize items-center justify-center bg-transparent"
            onPointerDown={handleWorkbenchResizeStart}
          >
            <span className="h-full w-px rounded-full bg-[#dce7f5] transition group-hover:w-[3px] group-hover:bg-[#2f6bff]" />
          </button>
        </div>

        <section className="flex min-h-0 min-w-0 flex-col">
          <FormDesignerHeader
            appId={appId}
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
            activeCell={activeCell}
            fields={fields}
            gridRef={gridRef}
            rowCount={rowCount}
            selectedFieldId={selectedFieldId}
            showMatrix={showMatrix}
            onActiveCellChange={setActiveCell}
            onCanvasClick={() => setSelectedFieldId(null)}
            onCanvasDoubleClick={openPageProperties}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDropToGroup={handleDropToGroup}
            onFieldPropertiesOpen={openFieldProperties}
            onFieldSelect={selectField}
            onPlacedFieldDragEnd={endDragging}
            onPlacedFieldDragStart={handlePlacedFieldDragStart}
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
  );
}

function hasDragType(event: DragEvent<HTMLDivElement>, dragType: string) {
  return Array.from(event.dataTransfer.types).includes(dragType);
}
