/** 表单属性面板：仅展示已接入运行时的配置。 */
"use client";
import { FormEventsPanel } from "./FormEventsPanel";
import { PropertyButton, PropertyInput, PropertySelectField, PropertySwitch, PropertyTextField } from "../property-panel/PropertyControls";

import type { DesignerPageAsset, PageDesignerProps } from "../../designer-types";
import { PropertyGroup, PropertyPanelHeader, PropertyRow, PropertySection as PageSection } from "../property-panel/PropertyLayout";

type PagePropertyPanelProps = {
  appId: string | null;
  formUuid: string;
  onOpenAutomation: (name: string) => void;
  formName: string;
  formType: "normal" | "workflow" | "defined";
  pageProps: PageDesignerProps;
  onPropsChange: (props: PageDesignerProps) => void;
};

export function PagePropertyPanel({
  appId,
  formUuid,
  onOpenAutomation,
  formName,
  formType,
  pageProps,
  onPropsChange,
}: PagePropertyPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <PropertyPanelHeader
        title={formName || "表单属性"}
        description="表单配置"
      />
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        <PropertyGroup title="基础属性">
          <PropertyRow label="提交文案">
            <PropertyTextField
              value={pageProps.submitButtonText}
              onChange={(submitButtonText) =>
                onPropsChange({ ...pageProps, submitButtonText })
              }
            />
          </PropertyRow>
        </PropertyGroup>
        <PropertyGroup title="表单事件">
          <FormEventsPanel key={`${appId}:${formUuid}`} appId={appId} formUuid={formUuid} onOpen={onOpenAutomation} />
        </PropertyGroup>
        {formType === "defined" ? (
          <PropertyGroup title="页面资源">
            <PageAssetsPanel
              assets={pageProps.assets}
              onChange={(assets) => onPropsChange({ ...pageProps, assets })}
            />
          </PropertyGroup>
        ) : null}
      </div>
    </div>
  );
}

function PageAssetsPanel({
  assets,
  onChange,
}: {
  assets: DesignerPageAsset[];
  onChange: (assets: DesignerPageAsset[]) => void;
}) {
  function update(assetId: string, patch: Partial<DesignerPageAsset>) {
    onChange(
      assets.map((asset) =>
        asset.id === assetId ? { ...asset, ...patch } : asset,
      ),
    );
  }

  return (
    <PageSection title="登记资源">
      <p className="text-xs leading-5 text-[var(--color-text-secondary)]">
        自定义页面通过 ctx.assets.loadScript(id) 或 ctx.assets.loadStyle(id)
        加载已登记资源。
      </p>
      <div className="space-y-3">
        {assets.map((asset) => (
          <div
            key={asset.id}
            className="space-y-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-2"
          >
            <div className="flex items-center gap-2">
              <PropertyInput
                className="min-w-0 flex-1"
                value={asset.id}
                aria-label="资源 ID"
                onChange={(event) =>
                  update(asset.id, { id: event.currentTarget.value })
                }
              />
              <PropertySelectField
                ariaLabel="资源类型"
                value={asset.type}
                options={[
                  { value: "script", label: "Script" },
                  { value: "style", label: "Style" },
                ]}
                onChange={(type) =>
                  update(asset.id, { type: type as DesignerPageAsset["type"] })
                }
              />
              <PropertyButton
                isIconOnly
                aria-label="删除资源"
                variant="ghost"
                onPress={() =>
                  onChange(assets.filter((item) => item.id !== asset.id))
                }
              >
                <DeleteIcon />
              </PropertyButton>
            </div>
            <PropertyInput
              className="w-full"
              placeholder="资源名称"
              value={asset.name}
              aria-label="资源名称"
              onChange={(event) =>
                update(asset.id, { name: event.currentTarget.value })
              }
            />
            <PropertyInput
              className="w-full font-mono"
              placeholder="https://cdn.example.com/library.min.js"
              value={asset.url}
              aria-label="资源 URL"
              onChange={(event) =>
                update(asset.id, { url: event.currentTarget.value })
              }
            />
            <PropertyInput
              className="w-full font-mono"
              placeholder="sha384-...（推荐）"
              value={asset.integrity ?? ""}
              aria-label="完整性哈希"
              onChange={(event) =>
                update(asset.id, { integrity: event.currentTarget.value })
              }
            />
            <div className="flex items-center gap-2 text-xs">
              <PropertySwitch
                aria-label="启用资源"
                isSelected={asset.enabled}
                onChange={(enabled) => update(asset.id, { enabled })}
              />
              启用
            </div>
          </div>
        ))}
      </div>
      <PropertyButton
        fullWidth
        variant="ghost"
        onPress={() =>
          onChange([
            ...assets,
            {
              id: `asset_${Date.now()}`,
              name: "新资源",
              type: "script",
              url: "",
              integrity: "",
              enabled: true,
            },
          ])
        }
      >
        添加资源
      </PropertyButton>
    </PageSection>
  );
}

function DeleteIcon() {
  return (
    <svg
      aria-hidden="true"
      className="w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 7h12M9 7V5h6v2m-7 0 .7 12h6.6L16 7"
      />
    </svg>
  );
}
