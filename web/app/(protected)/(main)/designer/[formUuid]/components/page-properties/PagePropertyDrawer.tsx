/**
 * 页面属性抽屉
 * */

"use client";

import { Button, Input } from "@heroui/react";
import type { DesignerPageAsset, PageDesignerProps, PageNamedRule } from "../../designer-types";
import {
  CodeToken,
  IconAction,
  PanelSwitch,
  PropertyFold,
  PropertyPanel,
  PropertyRow,
  TextWithActions,
} from "../field-properties/PropertyLayout";

type PagePropertyPanelProps = {
  formName: string;
  formType: "normal" | "workflow" | "defined";
  pageProps: PageDesignerProps;
  onPropsChange: (props: PageDesignerProps) => void;
};

type RuleListKey =
  | "formulaValidations"
  | "serviceValidations"
  | "customServiceValidations"
  | "businessFailureRules"
  | "integrationAutomations"
  | "serviceExecutions"
  | "customServiceExecutions"
  | "beforeSubmitActions"
  | "afterSubmitActions"
  | "afterDataInitActions";

export function PagePropertyPanel({
  formName,
  formType,
  pageProps,
  onPropsChange,
}: PagePropertyPanelProps) {
  function updateRuleList(key: RuleListKey, rules: PageNamedRule[]) {
    onPropsChange({ ...pageProps, [key]: rules });
  }

  function addRule(key: RuleListKey, label: string) {
    updateRuleList(key, [
      ...pageProps[key],
      { id: `${key}-${Date.now()}`, label },
    ]);
  }

  function removeRule(key: RuleListKey, ruleId: string) {
    updateRuleList(
      key,
      pageProps[key].filter((rule) => rule.id !== ruleId),
    );
  }

  function renameRule(key: RuleListKey, ruleId: string, label: string) {
    updateRuleList(
      key,
      pageProps[key].map((rule) =>
        rule.id === ruleId ? { ...rule, label } : rule,
      ),
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col text-[11px] text-[var(--color-text-primary)]">
      <header className="border-b border-[var(--designer-border)] p-1">
        <h2 className="truncate text-xs font-medium text-[var(--color-text-primary)]">
          {formName} 页面属性
        </h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-0 py-0">
              <PropertyFold title="表单校验">
                <PageSection title="公式校验">
                  <RuleList
                    rules={pageProps.formulaValidations}
                    onRemove={(ruleId) =>
                      removeRule("formulaValidations", ruleId)
                    }
                    onRename={(ruleId, label) =>
                      renameRule("formulaValidations", ruleId, label)
                    }
                  />
                  <Button
                    fullWidth
                    size="sm"
                    variant="ghost"
                    onPress={() => addRule("formulaValidations", "新公式")}
                  >
                    添加公式
                  </Button>
                </PageSection>

                <PageSection title="服务校验">
                  <RuleList
                    rules={pageProps.serviceValidations}
                    onRemove={(ruleId) =>
                      removeRule("serviceValidations", ruleId)
                    }
                    onRename={(ruleId, label) =>
                      renameRule("serviceValidations", ruleId, label)
                    }
                  />
                  <Button
                    fullWidth
                    size="sm"
                    variant="ghost"
                    onPress={() => addRule("serviceValidations", "新服务")}
                  >
                    添加服务
                  </Button>
                </PageSection>

                <PageSection title="自定义代码服务校验">
                  <RuleList
                    rules={pageProps.customServiceValidations}
                    onRemove={(ruleId) =>
                      removeRule("customServiceValidations", ruleId)
                    }
                    onRename={(ruleId, label) =>
                      renameRule("customServiceValidations", ruleId, label)
                    }
                  />
                  <Button
                    fullWidth
                    size="sm"
                    variant="ghost"
                    onPress={() =>
                      addRule("customServiceValidations", "新服务二开")
                    }
                  >
                    添加服务二开
                  </Button>
                </PageSection>
              </PropertyFold>

              <PropertyFold title="表单事件">
                <PageSection title="公式执行">
                  <PropertyRow label="运行失败时，终止后续规则" align="start">
                    <PanelSwitch
                      isSelected={pageProps.stopRulesOnFailure}
                      onChange={(value) =>
                        onPropsChange({
                          ...pageProps,
                          stopRulesOnFailure: value,
                        })
                      }
                    />
                  </PropertyRow>
                  <RuleList
                    rules={pageProps.businessFailureRules}
                    onRemove={(ruleId) =>
                      removeRule("businessFailureRules", ruleId)
                    }
                    onRename={(ruleId, label) =>
                      renameRule("businessFailureRules", ruleId, label)
                    }
                  />
                  <Button
                    fullWidth
                    size="sm"
                    variant="ghost"
                    onPress={() =>
                      addRule("businessFailureRules", "业务关联规则")
                    }
                  >
                    添加业务关联规则
                  </Button>
                  <RuleList
                    emphasis
                    rules={pageProps.integrationAutomations}
                    onRemove={(ruleId) =>
                      removeRule("integrationAutomations", ruleId)
                    }
                    onRename={(ruleId, label) =>
                      renameRule("integrationAutomations", ruleId, label)
                    }
                  />
                </PageSection>

                <PageSection title="服务执行">
                  <RuleList
                    rules={pageProps.serviceExecutions}
                    onRemove={(ruleId) =>
                      removeRule("serviceExecutions", ruleId)
                    }
                    onRename={(ruleId, label) =>
                      renameRule("serviceExecutions", ruleId, label)
                    }
                  />
                  <Button
                    fullWidth
                    size="sm"
                    variant="ghost"
                    onPress={() => addRule("serviceExecutions", "新服务")}
                  >
                    添加服务
                  </Button>
                </PageSection>

                <PageSection title="服务二开执行">
                  <RuleList
                    rules={pageProps.customServiceExecutions}
                    onRemove={(ruleId) =>
                      removeRule("customServiceExecutions", ruleId)
                    }
                    onRename={(ruleId, label) =>
                      renameRule("customServiceExecutions", ruleId, label)
                    }
                  />
                  <Button
                    fullWidth
                    size="sm"
                    variant="ghost"
                    onPress={() =>
                      addRule("customServiceExecutions", "新服务二开")
                    }
                  >
                    添加服务二开
                  </Button>
                </PageSection>
              </PropertyFold>

              <PropertyFold title="高级">
                <PageSection title="按钮文案">
                  <PropertyPanel>
                    <PropertyRow label="提交">
                      <TextWithActions
                        value={pageProps.submitButtonText}
                        onChange={(value) =>
                          onPropsChange({
                            ...pageProps,
                            submitButtonText: value,
                          })
                        }
                      />
                    </PropertyRow>
                  </PropertyPanel>
                </PageSection>

                <ActionSection
                  addLabel="绑定动作"
                  listKey="beforeSubmitActions"
                  rules={pageProps.beforeSubmitActions}
                  title="表单提交前"
                  onAdd={addRule}
                  onRemove={removeRule}
                  onRename={renameRule}
                />
                <ActionSection
                  addLabel="绑定动作"
                  listKey="afterSubmitActions"
                  rules={pageProps.afterSubmitActions}
                  title="表单提交后"
                  onAdd={addRule}
                  onRemove={removeRule}
                  onRename={renameRule}
                />
                <ActionSection
                  addLabel="绑定动作"
                  listKey="afterDataInitActions"
                  rules={pageProps.afterDataInitActions}
                  title="表单数据初始化后"
                  onAdd={addRule}
                  onRemove={removeRule}
                  onRename={renameRule}
                />

                <PageSection
                  title="表单数据源"
                  rightIcon={<CodeToken />}
                >
                  <Button
                    fullWidth
                    size="sm"
                    variant="ghost"
                    onPress={() =>
                      onPropsChange({
                        ...pageProps,
                        dataSourceCode:
                          pageProps.dataSourceCode || "// 表单数据源",
                      })
                    }
                  >
                    编辑代码
                  </Button>
                </PageSection>
              </PropertyFold>
              {formType === "defined" ? (
                <PropertyFold title="页面资源">
                  <PageAssetsPanel
                    assets={pageProps.assets}
                    onChange={(assets) => onPropsChange({ ...pageProps, assets })}
                  />
                </PropertyFold>
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
    onChange(assets.map((asset) => asset.id === assetId ? { ...asset, ...patch } : asset));
  }

  return (
    <PageSection title="登记资源">
      <p className="text-xs leading-5 text-[var(--color-text-secondary)]">
        自定义页面通过 ctx.assets.loadScript(id) 或 ctx.assets.loadStyle(id) 加载已登记资源。
      </p>
      <div className="space-y-3">
        {assets.map((asset) => (
          <div key={asset.id} className="space-y-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-2">
            <div className="flex items-center gap-2">
              <input className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-2 py-1 text-xs" value={asset.id} aria-label="资源 ID" onChange={(event) => update(asset.id, { id: event.currentTarget.value })} />
              <select className="rounded border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-2 py-1 text-xs" value={asset.type} aria-label="资源类型" onChange={(event) => update(asset.id, { type: event.currentTarget.value as DesignerPageAsset["type"] })}><option value="script">Script</option><option value="style">Style</option></select>
              <Button isIconOnly aria-label="删除资源" size="sm" variant="ghost" onPress={() => onChange(assets.filter((item) => item.id !== asset.id))}><DeleteIcon /></Button>
            </div>
            <input className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-2 py-1 text-xs" placeholder="资源名称" value={asset.name} aria-label="资源名称" onChange={(event) => update(asset.id, { name: event.currentTarget.value })} />
            <input className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-2 py-1 font-mono text-xs" placeholder="https://cdn.example.com/library.min.js" value={asset.url} aria-label="资源 URL" onChange={(event) => update(asset.id, { url: event.currentTarget.value })} />
            <input className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-2 py-1 font-mono text-xs" placeholder="sha384-...（推荐）" value={asset.integrity ?? ""} aria-label="完整性哈希" onChange={(event) => update(asset.id, { integrity: event.currentTarget.value })} />
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={asset.enabled} onChange={(event) => update(asset.id, { enabled: event.currentTarget.checked })} />启用</label>
          </div>
        ))}
      </div>
      <Button fullWidth size="sm" variant="ghost" onPress={() => onChange([...assets, { id: `asset_${Date.now()}`, name: "新资源", type: "script", url: "", integrity: "", enabled: true }])}>添加资源</Button>
    </PageSection>
  );
}

function ActionSection({
  addLabel,
  listKey,
  rules,
  title,
  onAdd,
  onRemove,
  onRename,
}: {
  addLabel: string;
  listKey: RuleListKey;
  rules: PageNamedRule[];
  title: string;
  onAdd: (key: RuleListKey, label: string) => void;
  onRemove: (key: RuleListKey, ruleId: string) => void;
  onRename: (key: RuleListKey, ruleId: string, label: string) => void;
}) {
  return (
    <PageSection title={title}>
      <RuleList
        rules={rules}
        onRemove={(ruleId) => onRemove(listKey, ruleId)}
        onRename={(ruleId, label) => onRename(listKey, ruleId, label)}
      />
      <Button
        fullWidth
        size="sm"
        variant="ghost"
        onPress={() => onAdd(listKey, addLabel)}
      >
        {addLabel}
      </Button>
    </PageSection>
  );
}

function PageSection({
  children,
  rightIcon,
  title,
}: {
  children: React.ReactNode;
  rightIcon?: React.ReactNode;
  title: string;
}) {
  return (
    <section className="space-y-2">
      <div className="flex h-8 items-center justify-between border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2 text-sm font-semibold text-[var(--color-text-primary)]">
        <span>{title}</span>
        {rightIcon ? <span className="text-[var(--color-text-disabled)]">{rightIcon}</span> : null}
      </div>
      <div className="space-y-2 px-1 pb-2">{children}</div>
    </section>
  );
}

function RuleList({
  emphasis,
  rules,
  onRemove,
  onRename,
}: {
  emphasis?: boolean;
  rules: PageNamedRule[];
  onRemove: (ruleId: string) => void;
  onRename: (ruleId: string, label: string) => void;
}) {
  void emphasis;

  if (rules.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1">
      {rules.map((rule) => (
        <div
          key={rule.id}
          className="flex min-w-0 items-center gap-2 px-1 text-sm text-[var(--color-text-primary)]"
        >
          <Input
            aria-label="规则名称"
            className="flex-1"
            value={rule.label}
            onChange={(event) => onRename(rule.id, event.currentTarget.value)}
          />
          <IconAction label="编辑" icon={<EditIcon />} />
          <Button
            aria-label="删除"
            isIconOnly
            size="sm"
            variant="ghost"
            onPress={() => onRemove(rule.id)}
            className="h-7 w-7 min-w-7 shrink-0 rounded-lg p-0 text-[var(--color-text-disabled)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]"
          >
            <DeleteIcon />
          </Button>
        </div>
      ))}
    </div>
  );
}

function EditIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m16.9 4.7 2.4 2.4M5 19h4l9.5-9.5a1.7 1.7 0 0 0 0-2.4L16.9 5.5a1.7 1.7 0 0 0-2.4 0L5 15v4Z"
      />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
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
