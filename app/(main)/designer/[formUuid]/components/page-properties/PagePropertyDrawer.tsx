/**
 * 页面属性抽屉
 * */

"use client";

import { Button, Input } from "@heroui/react";
import { Drawer } from "@heroui/react/drawer";
import type { PageDesignerProps, PageNamedRule } from "../../designer-types";
import {
  CodeToken,
  IconAction,
  PanelSwitch,
  PropertyFold,
  PropertyPanel,
  PropertyRow,
  TextWithActions,
} from "../field-properties/PropertyLayout";

type PagePropertyDrawerProps = {
  isOpen: boolean;
  pageProps: PageDesignerProps;
  onOpenChange: (isOpen: boolean) => void;
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

export function PagePropertyDrawer({
  isOpen,
  pageProps,
  onOpenChange,
  onPropsChange,
}: PagePropertyDrawerProps) {
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
    <Drawer isOpen={isOpen} onOpenChange={onOpenChange}>
      <Drawer.Backdrop className="theme-modal-backdrop" isDismissable>
        <Drawer.Content placement="right" className="designer-properties-drawer">
          <Drawer.Dialog className="flex h-full w-full flex-col bg-[var(--designer-surface-solid)] text-[var(--color-text-primary)] shadow-[var(--shadow-drawer)]">
            <Drawer.Header className="border-b border-[var(--designer-border)] px-4 py-3">
              <Drawer.Heading className="sr-only">页面属性</Drawer.Heading>
              <div className="relative flex h-12 items-center pr-10">
                <div>
                  <div className="font-semibold text-[var(--color-text-primary)]">页面属性</div>
                  <div className="text-xs text-[var(--color-text-secondary)]">校验、事件与数据源配置</div>
                </div>
                <Drawer.CloseTrigger
                  aria-label="关闭页面属性"
                  className="absolute right-0 top-1"
                />
              </div>
            </Drawer.Header>

            <Drawer.Body className="flex-1 overflow-y-auto px-0 py-0">
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
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
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
