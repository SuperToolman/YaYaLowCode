"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "@heroui/react";
import {
  createFormView,
  deleteFormView,
  listFormViews,
  updateFormView,
} from "../../../lib/api-client";

export type ViewFilterOperator = "contains" | "equals" | "notEquals" | "greaterThan" | "lessThan";
export type ViewFilterRule = { id: string; fieldId: string; operator: ViewFilterOperator; value: string };
export type ViewSortRule = { id: string; fieldId: string; direction: "asc" | "desc" };
export type ViewConfig = { visibleFieldIds: string[]; filters: ViewFilterRule[]; sorts: ViewSortRule[] };
export type FormView = { id: string; viewUuid?: string; name: string; isDefault: boolean; config: ViewConfig; updatedAt: string };
export type ViewConfigMode = "filters" | "fields" | "sorts";

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
  const [activeViewId, setActiveViewId] = useState("default");
  const [viewConfigMode, setViewConfigMode] = useState<ViewConfigMode | null>(null);
  const [viewConfigDraft, setViewConfigDraft] = useState<ViewConfig | null>(null);
  const [pendingViewConfig, setPendingViewConfig] = useState<ViewConfig | null>(null);
  const [viewDeleteTarget, setViewDeleteTarget] = useState<FormView | null>(null);

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
      }).catch((reason: unknown) => toast.danger(reason instanceof Error ? reason.message : "无法加载表单视图"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [defaultViewConfig, enabled, formUuid]);

  function openViewConfig(mode: ViewConfigMode) {
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
      toast.danger(data?.message || "保存视图失败");
      return;
    }
    const updatedAt = data.data.updatedAt;
    setViews((current) => current.map((view) => view.id === activeFormView.id ? { ...view, config: pendingViewConfig, updatedAt } : view));
    setPendingViewConfig(null);
    setViewConfigDraft(null);
    toast.success("视图配置已保存");
  }

  async function createTableView() {
    const { data, error } = await createFormView({
      path: { formUuid },
      body: { name: "未命名表格视图", config: defaultViewConfig },
      responseStyle: "fields",
    });
    if (error || !data || data.code !== 0 || !data.data) {
      toast.danger(data?.message || "创建视图失败");
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

  async function confirmDeleteView() {
    if (!viewDeleteTarget?.viewUuid) return null;
    const { error } = await deleteFormView({ path: { formUuid, viewUuid: viewDeleteTarget.viewUuid }, responseStyle: "fields" });
    if (error) {
      toast.danger("删除视图失败");
      return null;
    }
    const nextViews = views.filter((item) => item.id !== viewDeleteTarget.id);
    setViews(nextViews);
    setViewDeleteTarget(null);
    return nextViews.find((view) => view.isDefault) ?? null;
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
      toast.danger(data?.message || "复制视图失败");
      return null;
    }
    const view: FormView = { id: `view-${data.data.viewUuid}`, viewUuid: data.data.viewUuid, name: data.data.name, isDefault: false, config: data.data.config as ViewConfig, updatedAt: data.data.updatedAt };
    setViews((current) => [...current, view]);
    return view;
  }

  return {
    activeFormView,
    activeViewId,
    applyViewConfigDraft,
    closeViewConfig,
    confirmDeleteView,
    createTableView,
    deleteView,
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
