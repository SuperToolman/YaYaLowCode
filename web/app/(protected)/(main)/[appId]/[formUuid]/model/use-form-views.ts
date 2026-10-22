"use client";
import { notify } from "@lib/notify";

import { useEffect, useMemo, useState } from "react";
import {
  createFormView,
  deleteFormView,
  listFormViews,
  updateFormView,
} from "@/features/form-runtime/api";

export type ViewFilterOperator = "contains" | "equals" | "notEquals" | "greaterThan" | "lessThan";
export type ViewFilterRule = { id: string; fieldId: string; operator: ViewFilterOperator; value: string };
export type ViewSortRule = { id: string; fieldId: string; direction: "asc" | "desc" };
export type ViewConfig = {
  customButtons?: import("@/features/custom-buttons/bindings").ButtonBinding[];
  visibleFieldIds: string[];
  sortableFieldIds: string[];
  filters: ViewFilterRule[];
  sorts: ViewSortRule[];
  columnOrder?: string[];
  columnWidths?: Record<string, number>;
  frozenFieldIds?: string[];
};
export type FormView = { id: string; viewUuid?: string; name: string; isDefault: boolean; config: ViewConfig; updatedAt: string };
export type ViewConfigMode = "filters" | "fields" | "sorts" | "customButtons";

function cloneViewConfig(config: ViewConfig) {
  return JSON.parse(JSON.stringify(config)) as ViewConfig;
}

export function useFormViews({
  formUuid,
  defaultViewConfig,
  enabled,
}: {
  formUuid: string;
  defaultViewConfig: ViewConfig;
  enabled: boolean;
}) {
  const [views, setViews] = useState<FormView[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [activeViewId, setActiveViewId] = useState("default");
  const [viewConfigMode, setViewConfigMode] = useState<ViewConfigMode | null>(null);
  const [viewConfigDraft, setViewConfigDraft] = useState<ViewConfig | null>(null);
  const [pendingViewConfig, setPendingViewConfig] = useState<ViewConfig | null>(null);
  const [viewDeleteTarget, setViewDeleteTarget] = useState<FormView | null>(null);
  const [viewNameDraft, setViewNameDraft] = useState("");
  const [isRenamingView, setIsRenamingView] = useState(false);
  const [isDeletingView, setIsDeletingView] = useState(false);

  const activeFormView = useMemo(
    () => views.find((view) => view.id === activeViewId) ?? views[0],
    [activeViewId, views],
  );
  const effectiveViewConfig = pendingViewConfig ?? activeFormView?.config ?? defaultViewConfig;
  const viewConfigDirty = Boolean(
    pendingViewConfig && JSON.stringify(pendingViewConfig) !== JSON.stringify(activeFormView?.config ?? defaultViewConfig),
  );

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => {
      void listFormViews({ path: { formUuid }, responseStyle: "fields" }).then(({ data, error }) => {
        if (error || !data || data.code !== 0 || !data.data) throw new Error(data?.message || "无法加载表单视图");
        const savedDefaultView = data.data.find((view) => view.viewUuid === "default");
        const stored: FormView[] = [
          {
            id: "default",
            viewUuid: "default",
            name: "全部数据",
            isDefault: true,
            config: savedDefaultView ? savedDefaultView.config as ViewConfig : defaultViewConfig,
            updatedAt: savedDefaultView?.updatedAt ?? new Date().toISOString(),
          },
          ...data.data
            .filter((view) => view.viewUuid !== "default")
            .map((view) => ({ id: `view-${view.viewUuid}`, viewUuid: view.viewUuid, name: view.name, isDefault: false, config: view.config as ViewConfig, updatedAt: view.updatedAt })),
        ];
        setViews(stored);
        setActiveViewId((current) => stored.some((view) => view.id === current) ? current : "default");
        setIsReady(true);
      }).catch((reason: unknown) => {
        setIsReady(true);
        notify.error(reason instanceof Error ? reason.message : "无法加载表单视图");
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [defaultViewConfig, enabled, formUuid]);

  function openViewConfig(mode: ViewConfigMode) {
    setViewNameDraft(activeFormView?.name ?? "");
    setViewConfigDraft(cloneViewConfig(effectiveViewConfig));
    setViewConfigMode(mode);
  }

  function applyViewConfigDraft() {
    if (!viewConfigDraft) return;
    setPendingViewConfig(cloneViewConfig(viewConfigDraft));
    setViewConfigDraft(null);
    setViewConfigMode(null);
  }

  function closeViewConfig() {
    setViewConfigDraft(null);
    setViewConfigMode(null);
  }

  async function saveViewConfig() {
    if (!pendingViewConfig || !activeFormView) return;
    const { data, error } = await updateFormView({
      path: { formUuid, viewUuid: activeFormView.viewUuid ?? "default" },
      body: { name: activeFormView.name, config: pendingViewConfig },
      responseStyle: "fields",
    });
    if (error || !data || data.code !== 0 || !data.data) {
      notify.error(data?.message || "保存视图失败");
      return;
    }
    const updatedAt = data.data.updatedAt;
    setViews((current) => current.map((view) => view.id === activeFormView.id ? { ...view, config: pendingViewConfig, updatedAt } : view));
    setPendingViewConfig(null);
    setViewConfigDraft(null);
    notify.success("视图配置已保存");
  }

  async function createTableView() {
    const { data, error } = await createFormView({
      path: { formUuid },
      body: { name: "未命名表格视图", config: defaultViewConfig },
      responseStyle: "fields",
    });
    if (error || !data || data.code !== 0 || !data.data) {
      notify.error(data?.message || "创建视图失败");
      return null;
    }
    const view: FormView = { id: `view-${data.data.viewUuid}`, viewUuid: data.data.viewUuid, name: data.data.name, isDefault: false, config: data.data.config as ViewConfig, updatedAt: data.data.updatedAt };
    setViews((current) => [...current, view]);
    return view;
  }

  function deleteView(viewId: string) {
    const view = views.find((item) => item.id === viewId);
    if (!view || view.isDefault) return;
    setViewDeleteTarget(view);
  }

  async function renameActiveView() {
    if (!activeFormView?.viewUuid || activeFormView.isDefault || isRenamingView || isDeletingView) return;
    const name = viewNameDraft.trim();
    if (!name) {
      notify.error("视图名称不能为空");
      return;
    }
    if (name === activeFormView.name) return;
    setIsRenamingView(true);
    try {
      const { data, error } = await updateFormView({
        path: { formUuid, viewUuid: activeFormView.viewUuid },
        body: { name, config: activeFormView.config },
        responseStyle: "fields",
      });
      if (error || !data || data.code !== 0 || !data.data) {
        notify.error(data?.message || "修改视图名称失败");
        return;
      }
      const saved = data.data;
      setViews(current => current.map(view => view.id === activeFormView.id ? { ...view, name: saved.name, updatedAt: saved.updatedAt } : view));
      setViewNameDraft(saved.name);
      notify.success("视图名称已更新");
    } catch {
      notify.error("修改视图名称失败");
    } finally {
      setIsRenamingView(false);
    }
  }

  async function confirmDeleteView() {
    if (!viewDeleteTarget?.viewUuid || viewDeleteTarget.isDefault || isDeletingView || isRenamingView) return null;
    setIsDeletingView(true);
    try {
      const { data, error } = await deleteFormView({ path: { formUuid, viewUuid: viewDeleteTarget.viewUuid }, responseStyle: "fields" });
      const response = data && typeof data === "object" ? data : null;
      if (error || !response || ("code" in response && response.code !== 0)) {
        notify.error(response && "message" in response && typeof response.message === "string" ? response.message : "删除视图失败");
        return null;
      }
      setViews(current => current.filter(item => item.id !== viewDeleteTarget.id));
      setViewDeleteTarget(null);
      closeViewConfig();
      notify.success("视图已删除");
      return views.find(view => view.isDefault) ?? null;
    } catch {
      notify.error("删除视图失败");
      return null;
    } finally {
      setIsDeletingView(false);
    }
  }

  async function duplicateView(viewId: string) {
    const source = views.find((view) => view.id === viewId);
    if (!source) return null;
    const { data, error } = await createFormView({
      path: { formUuid },
      body: { name: `${source.name} 副本`, config: source.config },
      responseStyle: "fields",
    });
    if (error || !data || data.code !== 0 || !data.data) {
      notify.error(data?.message || "复制视图失败");
      return null;
    }
    const view: FormView = { id: `view-${data.data.viewUuid}`, viewUuid: data.data.viewUuid, name: data.data.name, isDefault: false, config: data.data.config as ViewConfig, updatedAt: data.data.updatedAt };
    setViews((current) => [...current, view]);
    return view;
  }

  return {
    activeFormView,
    activeViewId,
    isReady,
    applyViewConfigDraft,
    closeViewConfig,
    confirmDeleteView,
    createTableView,
    deleteView,
    renameActiveView,
    viewNameDraft,
    setViewNameDraft,
    isRenamingView,
    isDeletingView,
    effectiveViewConfig,
    openViewConfig,
    pendingViewConfig,
    saveViewConfig,
    setActiveViewId,
    setViewConfigMode,
    setPendingViewConfig,
    setViewConfigDraft,
    setViewDeleteTarget,
    viewConfigDirty,
    viewConfigDraft,
    viewConfigMode,
    viewDeleteTarget,
    views,
    duplicateView,
  };
}
