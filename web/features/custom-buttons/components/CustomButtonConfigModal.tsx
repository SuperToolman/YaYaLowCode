"use client";
import { assertApiResult } from "@/shared/lib/api-request";

import { notifyRequestError } from "@/shared/lib/notify";
import { CustomButtonAutomationConfig } from "./CustomButtonAutomationConfig";
import { CustomButtonParameters } from "./CustomButtonParameters";
import { notify } from "@/shared/lib/notify";
import { useEffect, useState, type SetStateAction } from "react";
import { Button, Input, InputGroup, Label, TextField, Select, ListBox, RadioGroup, Radio, Popover } from "@heroui/react";
import { ChevronDown } from "@gravity-ui/icons";
import { Modal } from "@heroui/react/modal";
import { FormSelect, type FormSelectOption } from "../../form-controls/components/FormSelect";
import { FieldSelect } from "../../form-controls/components/FieldSelect";
import { BranchRulesEditor } from "../../conditions/components/BranchRulesEditor";
import { addRule, removeRuleTree, updateRule } from "@/features/conditions";
import { getAppForms } from "@/features/application/resources";
import { getForm } from "@/shared/lib/http";
import { getDesignerSchema } from "@/features/form-model/schema-api";
import { BUTTON_ICONS } from "@/features/custom-buttons/icons";
import { changeTarget, emptyDraft, draftFromDefinition, validateDraft, validatePageParameters, writableFields, conditionFields, type ButtonDefinition, type ButtonDraft, type SchemaField } from "@/features/custom-buttons/model";
import { validateAssociationRules, validateButtonConditions } from "@/features/custom-buttons/bindings";
import { DEFAULT_DISABLED_REASON } from "@/features/custom-buttons/model";

export function CustomButtonConfigModal({
  appId,
  button,
  ownerFormUuid,
  initialDraft,
  mode,
  onClose,
  onSave,
}: {
  appId: string;
  button?: ButtonDefinition;
  ownerFormUuid: string;
  initialDraft?: ButtonDraft;
  mode: "create" | "edit" | "view";
  onClose: () => void;
  onSave: (draft: ButtonDraft) => Promise<void>;
}) {
  const [draft, setDraftState] = useState<ButtonDraft>(() =>
    normalizeCurrentTarget(
      button ? draftFromDefinition(button) : (initialDraft ?? emptyDraft()),
      appId,
      ownerFormUuid,
    ),
  );
  function setDraft(update: SetStateAction<ButtonDraft>) {
    setDraftState((current) =>
      normalizeCurrentTarget(
        typeof update === "function" ? update(current) : update,
        appId,
        ownerFormUuid,
      ),
    );
  }
  const [forms, setForms] = useState<FormSelectOption[]>([]);
  const [target, setTarget] = useState<{
    formUuid: string;
    fields: SchemaField[];
    workflow: boolean;
    name: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [ownerSchema, setOwnerSchema] = useState<{
    fields: SchemaField[];
    workflow: boolean;
  } | null>(null);
  const [pendingTarget, setPendingTarget] = useState<FormSelectOption | null>(
    null,
  );
  const readOnly = mode === "view";
  useEffect(() => {
    let cancelled = false;
    getAppForms(appId, true)
      .then((items) => {
        if (!cancelled) setForms(items);
      })
      .catch((e) => {
        if (!cancelled) notifyRequestError(e, e.message || "加载表单失败");
      });
    return () => {
      cancelled = true;
    };
  }, [appId]);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getDesignerSchema(ownerFormUuid, decodeButtonSchema),
      getForm({ path: { formUuid: ownerFormUuid }, responseStyle: "fields" }),
    ])
      .then(([schema, result]) => {
        if (cancelled) return;
        const form = result.data?.data;
        setOwnerSchema({
          fields: schema.schema.fields ?? [],
          workflow: form?.formType === "workflow",
        });
      })
      .catch((error) => {
        if (!cancelled)
          notifyRequestError(error, 
            error instanceof Error ? error.message : "加载按钮条件字段失败",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [ownerFormUuid]);
  const formUuid = draft.actionConfig.targetFormUuid;
  useEffect(() => {
    if (draft.actionType !== "fill_form" || !formUuid) return;
    let cancelled = false;
    void Promise.all([
      getDesignerSchema(formUuid, decodeButtonSchema),
      getForm({ path: { formUuid }, responseStyle: "fields" }),
    ])
      .then(([schema, result]) => {
        if (cancelled) return;
        assertApiResult(result);
        const form = result.data.data;
        if (!["normal", "workflow"].includes(form.formType))
          throw new Error("填写对象必须是普通表单或流程表单");
        setTarget({
          formUuid,
          fields: schema.schema.fields ?? [],
          workflow: form.formType === "workflow",
          name: form.name,
        });
      })
      .catch((e) => {
        if (!cancelled) {
          setTarget(null);
          notifyRequestError(e, e.message || "无法加载填写对象");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [formUuid, draft.actionType]);
  const loaded = target?.formUuid === formUuid;
  const fields = loaded ? target.fields : [];
  const workflow = loaded ? target.workflow : false;
  const validation =
    validateDraft(draft, fields, workflow, ownerFormUuid) ||
    (draft.actionType === "open_page" ? validatePageParameters(draft.actionConfig.parameters ?? [], ownerSchema?.fields ?? [], ownerSchema?.workflow ?? false) : "") ||
    (draft.actionType === "fill_form" && formUuid !== ownerFormUuid && ownerSchema && loaded
      ? validateAssociationRules(draft.actionConfig.associationRules ?? [], conditionFields(fields, workflow), conditionFields(ownerSchema.fields, ownerSchema.workflow))
      : "") ||
    (ownerSchema
      ? validateButtonConditions(
          draft.availability,
          conditionFields(ownerSchema.fields, ownerSchema.workflow),
        )
      : "");
  function selectTarget(form: FormSelectOption) {
    if (form.id === formUuid) return;
    if (draft.actionConfig.fieldIds.length || draft.actionConfig.associationRules?.length) {
      setPendingTarget(form);
      return;
    }
    applyTarget(form);
  }
  function applyTarget(form: FormSelectOption) {
    setDraft((current) => changeTarget(current, form.appId ?? appId, form.id));
    setTarget(null);
    setPendingTarget(null);
  }
  async function save() {
    if (
      validation ||
      (draft.actionType === "fill_form" && !loaded) ||
      !ownerSchema
    ) {
      notify.error(
        validation ||
          (!ownerSchema
            ? "请等待当前表单字段加载完成"
            : "请等待填写对象加载完成"),
      );
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
    } catch (e) {
      notifyRequestError(e, e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }
  const invalidFields = draft.actionConfig.fieldIds.filter(
    (id) => !writableFields(fields).some((field) => field.id === id),
  );
  const selectedButtonIcon = BUTTON_ICONS.find(
    (item) => item.id === draft.icon,
  );
  const SelectedIcon = selectedButtonIcon?.Component;
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className="w-[780px] max-w-[calc(100vw-2rem)]">
            <Modal.Header>
              <Modal.Heading>
                {mode === "create"
                  ? "新建自定义按钮"
                  : mode === "edit"
                    ? "编辑自定义按钮"
                    : "查看自定义按钮"}
              </Modal.Heading>
              <Modal.CloseTrigger isDisabled={saving} />
            </Modal.Header>
            <Modal.Body>
              <fieldset
                disabled={readOnly || saving}
                className="flex min-w-0 flex-col gap-4"
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)]">
                  {/* 动作类型 */}
                  <Select
                    isRequired
                    selectedKey={draft.actionType}
                    isDisabled={readOnly || saving}
                    onSelectionChange={(key) => {
                      setPendingTarget(null);
                      setTarget(null);
                      setDraft({
                        ...draft,
                        actionType:
                          key === "run_automation"
                            ? "run_automation"
                            : key === "open_page"
                              ? "open_page"
                              : "fill_form",
                        actionConfig: {
                          targetAppId: "",
                          targetFormUuid: "",
                          fieldIds: [],
                          ...(key === "open_page"
                            ? {
                                linkType: "internal" as const,
                                pageMode: "view" as const,
                                openMode: "window" as const,
                                url: "",
                              }
                            : {}),
                        },
                      });
                    }}
                  >
                    <Label>动作类型</Label>
                    <Select.Trigger>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        <ListBox.Item id="fill_form" textValue="填写表单">
                          填写表单
                        </ListBox.Item>
                        <ListBox.Item id="open_page" textValue="打开页面">
                          打开页面
                        </ListBox.Item>
                        <ListBox.Item
                          id="run_automation"
                          textValue="集成自动化"
                        >
                          集成自动化
                        </ListBox.Item>
                      </ListBox>
                    </Select.Popover>
                  </Select>

                  {/* 按钮名称 */}
                  <TextField
                    fullWidth
                    isRequired
                    isDisabled={readOnly || saving}
                    value={draft.name}
                    onChange={(name) => setDraft({ ...draft, name })}
                  >
                    <Label>按钮名称</Label>
                    <InputGroup fullWidth className="min-w-0">
                      <InputGroup.Prefix className="px-1">
                        <Popover
                          isOpen={iconPickerOpen}
                          onOpenChange={setIconPickerOpen}
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="gap-1 px-2"
                            aria-label={`选择按钮图标，当前：${selectedButtonIcon?.label ?? "无图标"}`}
                            isDisabled={readOnly || saving}
                          >
                            {SelectedIcon ? (
                              <SelectedIcon width={16} height={16} />
                            ) : (
                              <span className="text-xs">无图标</span>
                            )}
                            <ChevronDown width={12} height={12} />
                          </Button>
                          <Popover.Content>
                            <Popover.Dialog aria-label="选择按钮图标">
                              <ListBox
                                aria-label="按钮图标"
                                selectionMode="single"
                                disallowEmptySelection
                                selectedKeys={[draft.icon || "none"]}
                                onSelectionChange={(keys) => {
                                  if (readOnly || saving || keys === "all") return;
                                  const key = Array.from(keys)[0];
                                  if (key == null) return;
                                  setDraft((current) => ({
                                    ...current,
                                    icon: key === "none" ? null : String(key),
                                  }));
                                  setIconPickerOpen(false);
                                }}
                              >
                                <ListBox.Item id="none" textValue="无图标">
                                  无图标
                                </ListBox.Item>
                                {BUTTON_ICONS.map((item) => (
                                  <ListBox.Item
                                    key={item.id}
                                    id={item.id}
                                    textValue={item.label}
                                  >
                                    <item.Component />
                                    {item.label}
                                  </ListBox.Item>
                                ))}
                              </ListBox>
                            </Popover.Dialog>
                          </Popover.Content>
                        </Popover>
                      </InputGroup.Prefix>
                      <InputGroup.Input className="min-w-0 ps-2" maxLength={100} />
                    </InputGroup>
                  </TextField>
                  <TextField
                    fullWidth
                    isDisabled={readOnly || saving}
                    value={draft.description}
                    onChange={(description) =>
                      setDraft({ ...draft, description })
                    }
                  >
                    <Label>按钮说明</Label>
                    <Input maxLength={2000} />
                  </TextField>
                </div>
                {draft.actionType === "fill_form" ? (
                  <>
                    <div className="flex flex-col gap-2">
                      <FormSelect
                        label="填写对象"
                        isRequired
                        appId={appId}
                        forms={forms}
                        formTypes={["normal", "workflow"]}
                        value={formUuid}
                        onChange={() => {}}
                        onFormSelect={selectTarget}
                        isDisabled={readOnly || saving}
                        placeholder="选择填写对象"
                      />
                    </div>
                    {formUuid === ownerFormUuid ? <div className="flex flex-col gap-2">
                      <FieldSelect
                        label="选择字段"
                        isRequired
                        selectionMode="multiple"
                        value={draft.actionConfig.fieldIds}
                        onChange={(ids) =>
                          setDraft({
                            ...draft,
                            actionConfig: {
                              ...draft.actionConfig,
                              fieldIds: ids,
                            },
                          })
                        }
                        options={writableFields(fields).map((f) => ({
                          key: f.id,
                          label: f.label || f.id,
                          fieldType: f.type,
                        }))}
                        isDisabled={readOnly || saving}
                      />
                      {formUuid && !loaded ? (
                        <p role="status">正在加载填写字段…</p>
                      ) : null}
                      {loaded && invalidFields.length ? (
                        <p className="text-sm text-[var(--color-warning)]">
                          已保存字段需重新选择：{invalidFields.join("、")}
                        </p>
                      ) : null}
                    </div> : <div className="flex min-w-0 flex-col gap-2">
                      <Label>关联实例条件</Label>
                      <p className="text-xs text-[var(--color-text-secondary)]">左侧为目标表单字段，比较字段来自当前记录。找到已有实例则编辑，未找到则新建。</p>
                      <div inert={readOnly || saving || !loaded}>
                        <BranchRulesEditor
                          rules={draft.actionConfig.associationRules ?? []}
                            targetFieldLabel="目标表单字段"
                          sourceFieldChoices={conditionFields(fields, workflow)}
                          comparisonFieldChoices={ownerSchema ? conditionFields(ownerSchema.fields, ownerSchema.workflow) : []}
                          onAddConditionRule={(parent, sibling, count) => setDraft(current => ({ ...current, actionConfig: { ...current.actionConfig, associationRules: addRule(current.actionConfig.associationRules ?? [], parent, sibling, count) } }))}
                          onRemoveConditionRule={id => setDraft(current => ({ ...current, actionConfig: { ...current.actionConfig, associationRules: removeRuleTree(current.actionConfig.associationRules ?? [], id) } }))}
                          onConditionRuleChange={(id, key, value) => setDraft(current => ({ ...current, actionConfig: { ...current.actionConfig, associationRules: updateRule(current.actionConfig.associationRules ?? [], id, key, value) } }))}
                        />
                      </div>
                      {!loaded ? <p role="status">正在加载关联条件字段…</p> : null}
                    </div>}
                  </>
                ) : draft.actionType === "run_automation" ? (
                  <CustomButtonAutomationConfig
                    appId={appId}
                    formUuid={ownerFormUuid}
                    value={draft.actionConfig.automationId || ""}
                    disabled={readOnly || saving}
                    buttonName={draft.name}
                    onChange={(automationId) =>
                      setDraft((current) => ({
                        ...current,
                        actionConfig: { ...current.actionConfig, automationId },
                      }))
                    }
                  />
                ) : (
                  <>
                    <RadioGroup
                      orientation="horizontal"
                      className="flex-wrap gap-x-6 gap-y-3"
                      isRequired
                      isDisabled={readOnly || saving}
                      value={draft.actionConfig.linkType ?? "internal"}
                      onChange={(value) =>
                        setDraft({
                          ...draft,
                          actionConfig: {
                            ...draft.actionConfig,
                            linkType: value as "internal" | "external",
                            targetAppId: "",
                            targetFormUuid: "",
                            url: "",
                          },
                        })
                      }
                    >
                      <Label>链接类型</Label>
                      <Radio value="internal">
                        <Radio.Content>
                          <Radio.Control>
                            <Radio.Indicator />
                          </Radio.Control>
                          <Label>应用内链接</Label>
                        </Radio.Content>
                      </Radio>
                      <Radio value="external">
                        <Radio.Content>
                          <Radio.Control>
                            <Radio.Indicator />
                          </Radio.Control>
                          <Label>外部链接</Label>
                        </Radio.Content>
                      </Radio>
                    </RadioGroup>
                    {draft.actionConfig.linkType === "external" ? (
                      <TextField
                        fullWidth
                        isRequired
                        isDisabled={readOnly || saving}
                        value={draft.actionConfig.url ?? ""}
                        onChange={(url) =>
                          setDraft({
                            ...draft,
                            actionConfig: { ...draft.actionConfig, url },
                          })
                        }
                      >
                        <Label>链接地址</Label>
                        <Input placeholder="https://" />
                      </TextField>
                    ) : (
                      <>
                        <FormSelect
                          label="选择表单"
                          isRequired
                          appId={appId}
                          forms={forms}
                          value={draft.actionConfig.targetFormUuid}
                          onChange={() => {}}
                          onFormSelect={(form) =>
                            setDraft({
                              ...draft,
                              actionConfig: {
                                ...draft.actionConfig,
                                targetAppId: form.appId ?? appId,
                                targetFormUuid: form.id,
                              },
                            })
                          }
                          isDisabled={readOnly || saving}
                        />
                        <Select
                          aria-label="页面模式"
                          isRequired
                          selectedKey={draft.actionConfig.pageMode ?? "view"}
                          isDisabled={readOnly || saving}
                          onSelectionChange={(key) =>
                            setDraft({
                              ...draft,
                              actionConfig: {
                                ...draft.actionConfig,
                                pageMode: key === "edit" ? "edit" : "view",
                              },
                            })
                          }
                        >
                          <Label>页面模式</Label>
                          <Select.Trigger>
                            <Select.Value />
                            <Select.Indicator />
                          </Select.Trigger>
                          <Select.Popover>
                            <ListBox>
                              <ListBox.Item id="edit">编辑</ListBox.Item>
                              <ListBox.Item id="view">查看</ListBox.Item>
                            </ListBox>
                          </Select.Popover>
                        </Select>
                      </>
                    )}
                    <RadioGroup
                      orientation="horizontal"
                      className="flex-wrap gap-x-6 gap-y-3"
                      isRequired
                      isDisabled={readOnly || saving}
                      value={draft.actionConfig.openMode ?? "window"}
                      onChange={(value) =>
                        setDraft({
                          ...draft,
                          actionConfig: {
                            ...draft.actionConfig,
                            openMode: value as "window" | "sidebar",
                          },
                        })
                      }
                    >
                      <Label>打开方式</Label>
                      <Radio value="window">
                        <Radio.Content>
                          <Radio.Control>
                            <Radio.Indicator />
                          </Radio.Control>
                          <Label>新窗口</Label>
                        </Radio.Content>
                      </Radio>
                      <Radio value="sidebar">
                        <Radio.Content>
                          <Radio.Control>
                            <Radio.Indicator />
                          </Radio.Control>
                          <Label>侧边栏</Label>
                        </Radio.Content>
                      </Radio>
                    </RadioGroup>
                  </>
                )}
                {draft.actionType === "open_page" ? <CustomButtonParameters
                  parameters={draft.actionConfig.parameters ?? []}
                  fields={conditionFields(ownerSchema?.fields ?? [], ownerSchema?.workflow ?? false)}
                  disabled={readOnly || saving}
                  onChange={parameters => setDraft({ ...draft, actionConfig: { ...draft.actionConfig, parameters } })}
                /> : null}
                <div className="border-t border-separator pt-4">
                  <RadioGroup
                    orientation="horizontal"
                    value={draft.availability.mode}
                    isDisabled={readOnly || saving}
                    aria-label="按钮可用条件"
                    onChange={(key) =>
                      setDraft({
                        ...draft,
                        availability: {
                          mode: key === "conditions" ? "conditions" : "all",
                          rules:
                            key === "conditions"
                              ? draft.availability.rules
                              : [],
                        },
                      })
                    }
                  >
                    <Label>按钮可用条件</Label>
                    <Radio value="all"><Radio.Content><Radio.Control><Radio.Indicator /></Radio.Control><Label>全部数据</Label></Radio.Content></Radio>
                    <Radio value="conditions"><Radio.Content><Radio.Control><Radio.Indicator /></Radio.Control><Label>满足筛选条件</Label></Radio.Content></Radio>
                  </RadioGroup>
                  {draft.availability.mode === "conditions" ? (
                    <>
                      {ownerSchema ? (
                        <div inert={readOnly || saving} className="mt-3">
                          <BranchRulesEditor
                            rules={draft.availability.rules}
                            sourceFieldChoices={conditionFields(
                              ownerSchema.fields,
                              ownerSchema.workflow,
                            )}
                            onAddConditionRule={(parent, sibling, count) =>
                              setDraft({
                                ...draft,
                                availability: {
                                  ...draft.availability,
                                  rules: addRule(
                                    draft.availability.rules,
                                    parent,
                                    sibling,
                                    count,
                                  ),
                                },
                              })
                            }
                            onRemoveConditionRule={(id) =>
                              setDraft({
                                ...draft,
                                availability: {
                                  ...draft.availability,
                                  rules: removeRuleTree(
                                    draft.availability.rules,
                                    id,
                                  ),
                                },
                              })
                            }
                            onConditionRuleChange={(id, key, value) =>
                              setDraft({
                                ...draft,
                                availability: {
                                  ...draft.availability,
                                  rules: updateRule(
                                    draft.availability.rules,
                                    id,
                                    key,
                                    value,
                                  ),
                                },
                              })
                            }
                          />
                        </div>
                      ) : (
                        <p role="status" className="mt-3">
                          正在加载当前表单字段…
                        </p>
                      )}
                      <TextField
                        fullWidth
                        className="mt-3"
                        isDisabled={readOnly || saving}
                        value={draft.disabledReason}
                        onChange={(disabledReason) =>
                          setDraft({ ...draft, disabledReason })
                        }
                      >
                        <Label>条件不满足说明</Label>
                        <Input
                          maxLength={1000}
                          placeholder={DEFAULT_DISABLED_REASON}
                        />
                      </TextField>
                    </>
                  ) : null}
                </div>
              </fieldset>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" isDisabled={saving} onPress={onClose}>
                {readOnly ? "关闭" : "取消"}
              </Button>
              {!readOnly ? (
                <Button isPending={saving} isDisabled={saving} onPress={save}>
                  保存
                </Button>
              ) : null}
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
      {pendingTarget ? (
        <Modal
          isOpen
          onOpenChange={(open) => {
            if (!open) setPendingTarget(null);
          }}
        >
          <Modal.Backdrop>
            <Modal.Container>
              <Modal.Dialog>
                <Modal.Header>
                  <Modal.Heading>更换填写对象？</Modal.Heading>
                </Modal.Header>
                <Modal.Body>更换表单将清空已选择的字段和关联实例条件。</Modal.Body>
                <Modal.Footer>
                  <Button
                    variant="secondary"
                    onPress={() => setPendingTarget(null)}
                  >
                    保留原配置
                  </Button>
                  <Button onPress={() => applyTarget(pendingTarget)}>
                    确认更换
                  </Button>
                </Modal.Footer>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
      ) : null}
    </Modal>
  );
}

function normalizeCurrentTarget(
  draft: ButtonDraft,
  appId: string,
  ownerFormUuid: string,
): ButtonDraft {
  if (
    draft.actionType !== "fill_form" ||
    !ownerFormUuid ||
    draft.actionConfig.targetFormUuid
  )
    return draft;
  return {
    ...draft,
    actionConfig: {
      ...draft.actionConfig,
      targetAppId: appId,
      targetFormUuid: ownerFormUuid,
      fieldIds: [],
    },
  };
}

function decodeButtonSchema(value: unknown): { fields: SchemaField[] } {
  if (!value || typeof value !== "object" || !("fields" in value) || !Array.isArray(value.fields)) return { fields: [] };
  return { fields: value.fields.filter((field): field is SchemaField => !!field && typeof field === "object" && typeof field.id === "string" && typeof field.type === "string") };
}
