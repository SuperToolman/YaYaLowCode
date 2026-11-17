"use client";

import type { DragEndEvent, SensorDescriptor, SensorOptions } from "@dnd-kit/core";
import { useCallback, useMemo, useState } from "react";
import { Button, Drawer, Input, ListBox, SearchField, Select, Table, Tabs, TextField, Label, Description, ButtonGroup, type Selection } from "@heroui/react";
import { TrashBin } from "@gravity-ui/icons";
import { MySurface } from "@/shared/ui/MySurface";
import { ReorderableViewFieldRow, ViewFieldsDragContext, type ViewFieldOption } from "@/features/records/screen/components/view-settings/ViewConfigComponents";
import type { ViewConfig, ViewConfigMode } from "@/features/records/screen/model/use-form-views";

import { ViewCustomButtonBindings } from "@/features/custom-buttons/components/ViewCustomButtonBindings";

import { BranchRulesEditor } from "@/features/conditions/components/BranchRulesEditor";
import { addRule, removeRuleTree, updateRule, validateRuleTree, type BranchRule } from "@/features/conditions";
import { viewConditionRules } from "../../model/view-conditions";

type Props = {
  appId: string;
  viewName: string;
  savedViewName: string;
  isDefaultView: boolean;
  isManagingView: boolean;
  onSaveViewName: (name: string) => void;
  onDeleteView: () => void;
  formUuid: string;
  isOpen: boolean;
  mode: ViewConfigMode | null;
  initialDraft: ViewConfig | null;
  onOpenChange: (open: boolean) => void;
  onSectionChange: (section: ViewConfigMode) => void;
  onClose: () => void;
  onApply: (draft: ViewConfig) => void;
  allFields: ViewFieldOption[];
  queryableFields: ViewFieldOption[];
  orderedFields: ViewFieldOption[];
  sensors: SensorDescriptor<SensorOptions>[];
  isDetailForm?: boolean;
};

export function FormTableSetting({
  appId,
  formUuid,
  viewName,
  savedViewName,
  isDefaultView,
  isManagingView,
  onSaveViewName,
  onDeleteView,
  isOpen,
  mode,
  initialDraft,
  onOpenChange,
  onSectionChange,
  onClose,
  onApply,
  allFields,
  queryableFields,
  orderedFields,
  sensors,
  isDetailForm = false,
}: Props) {
  const [draft, setDraft] = useState(initialDraft);
  const [fieldSearch, setFieldSearch] = useState("");
  const [fieldTypeFilter, setFieldTypeFilter] = useState("all");
  const [expandedFieldKeys, setExpandedFieldKeys] = useState<Selection>(
    new Set(),
  );
  const [previousInitialDraft, setPreviousInitialDraft] = useState(initialDraft);
  if (previousInitialDraft !== initialDraft) {
    setPreviousInitialDraft(initialDraft);
    setDraft(initialDraft);
  }
  const [localViewName, setLocalViewName] = useState(viewName);
  const [previousViewName, setPreviousViewName] = useState(viewName);
  if (previousViewName !== viewName) {
    setPreviousViewName(viewName);
    setLocalViewName(viewName);
  }
  const normalizedViewName = localViewName.trim();
  const canSaveViewName =
    normalizedViewName.length > 0 && normalizedViewName !== savedViewName;

  const orderedDraftFields = useMemo(() => {
    const order = draft?.columnOrder ?? orderedFields.map((field) => field.id);
    const fieldById = new Map(orderedFields.map((field) => [field.id, field]));
    const remaining = new Set(fieldById.keys());
    const ordered = order.flatMap((fieldId) => {
      const field = fieldById.get(fieldId);
      if (!field) return [];
      remaining.delete(fieldId);
      return [field];
    });
    const withRemaining = [
      ...ordered,
      ...orderedFields.filter((field) => remaining.has(field.id)),
    ];
    const frozenIds = new Set(draft?.frozenFieldIds ?? []);
    return [
      ...withRemaining.filter((field) => frozenIds.has(field.id)),
      ...withRemaining.filter((field) => !frozenIds.has(field.id)),
    ];
  }, [draft?.columnOrder, draft?.frozenFieldIds, orderedFields]);

  const viewFieldTree = useMemo(() => {
    const fieldsById = new Map(orderedDraftFields.map((field) => [field.id, field]));
    const childrenByParent = new Map<string, ViewFieldOption[]>();
    const roots: ViewFieldOption[] = [];
    for (const field of orderedDraftFields) {
      const parentId = field.parentSubformId;
      if (parentId && fieldsById.has(parentId)) {
        const children = childrenByParent.get(parentId) ?? [];
        children.push(field);
        childrenByParent.set(parentId, children);
      } else {
        roots.push(field);
      }
    }

    const buildTree = (fields: ViewFieldOption[]): ViewFieldOption[] =>
      fields.map((field) => {
        const children = buildTree(childrenByParent.get(field.id) ?? []);
        if (!field.isSubformGroup) return { ...field, children: undefined };
        return {
          ...field,
          linkedFieldIds: [
            ...new Set(
              children.flatMap((child) =>
                child.isSubformGroup
                  ? (child.linkedFieldIds ?? [])
                  : (child.linkedFieldIds ?? [child.id]),
              ),
            ),
          ],
          children,
        };
      });

    return buildTree(roots);
  }, [orderedDraftFields]);

  const fieldTypeOptions = useMemo(
    () =>
      Array.from(
        new Map(
          orderedDraftFields.map((field) => [field.type, field.typeLabel]),
        ),
      ),
    [orderedDraftFields],
  );
  const normalizedFieldSearch = fieldSearch.trim().toLocaleLowerCase();
  const visibleDraftFields = useMemo(
    () => {
      const filterTree = (fields: ViewFieldOption[]): ViewFieldOption[] =>
        fields.flatMap((field) => {
          const children = filterTree(field.children ?? []);
          const matchesSearch =
            !normalizedFieldSearch ||
            field.label.toLocaleLowerCase().includes(normalizedFieldSearch);
          const matchesType =
            fieldTypeFilter === "all" || field.type === fieldTypeFilter;
          if (field.isSubformGroup) {
            if (matchesSearch && matchesType)
              return [{ ...field, children: field.children }];
            return children.length ? [{ ...field, children }] : [];
          }
          return matchesSearch && matchesType ? [field] : [];
        });

      return filterTree(viewFieldTree);
    },
    [fieldTypeFilter, normalizedFieldSearch, viewFieldTree],
  );
  const isFieldFilterActive =
    normalizedFieldSearch.length > 0 || fieldTypeFilter !== "all";
  const expandedKeysForDisplay = useMemo(() => {
    if (!isFieldFilterActive) return expandedFieldKeys;
    const keys = new Set<string>();
    const addExpandedGroups = (fields: ViewFieldOption[]) => {
      for (const field of fields) {
        if (field.children?.length) keys.add(field.id);
        addExpandedGroups(field.children ?? []);
      }
    };
    addExpandedGroups(visibleDraftFields);
    return keys;
  }, [expandedFieldKeys, isFieldFilterActive, visibleDraftFields]);

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      if (!over || active.id === over.id) return;
      const sourceId = String(active.id).replace("view-field-", "");
      const targetId = String(over.id).replace("view-field-", "");
      const findField = (
        fields: ViewFieldOption[],
        fieldId: string,
      ): ViewFieldOption | undefined => {
        for (const field of fields) {
          if (field.id === fieldId) return field;
          const childMatch = findField(field.children ?? [], fieldId);
          if (childMatch) return childMatch;
        }
        return undefined;
      };
      const sourceField = findField(viewFieldTree, sourceId);
      const targetField = findField(viewFieldTree, targetId);
      if (!sourceField || !targetField) return;
      if (sourceField.parentSubformId !== targetField.parentSubformId) return;
      const sourceFieldIds = sourceField.linkedFieldIds ?? [sourceId];
      const targetFieldIds = targetField.linkedFieldIds ?? [targetId];

      setDraft((current) => {
        if (!current) return current;
        const frozenIds = new Set(current.frozenFieldIds ?? []);
        if (
          sourceFieldIds.some((id) => frozenIds.has(id)) !==
          targetFieldIds.some((id) => frozenIds.has(id))
        )
          return current;
        const currentOrder =
          current.columnOrder ?? orderedFields.map((field) => field.id);
        const sourceOrderIds = sourceField.isSubformGroup
          ? [sourceId]
          : sourceFieldIds;
        const targetOrderIds = targetField.isSubformGroup
          ? [targetId]
          : targetFieldIds;
        const sourceEntries = currentOrder.filter((id) =>
          sourceOrderIds.includes(id),
        );
        const nextOrder = currentOrder.filter(
          (id) => !sourceOrderIds.includes(id),
        );
        const targetIndex = nextOrder.findIndex((id) =>
          targetOrderIds.includes(id),
        );
        if (sourceEntries.length === 0 || targetIndex < 0) return current;
        nextOrder.splice(targetIndex, 0, ...sourceEntries);
        return { ...current, columnOrder: nextOrder };
      });
    },
    [orderedFields, viewFieldTree],
  );

  const conditionRules = useMemo(() => draft ? viewConditionRules(draft) : [], [draft]);
  const conditionFields = useMemo(() => queryableFields.map(field => ({ key: field.id, label: field.label, fieldType: ["createdAt", "updatedAt"].includes(field.id) ? "dateTime" : field.type === "builtin" ? "singleLineText" : field.type, props: field.props, options: (field.props?.options ?? []).map(option => typeof option === "string" ? { label: option, value: option } : option) })), [queryableFields]);
  const conditionError = conditionRules.length ? validateRuleTree(conditionRules, new Set(conditionFields.map(field => field.key))) : undefined;
  const changeConditions = (change: (rules: BranchRule[]) => BranchRule[]) => setDraft(current => current ? { ...current, filters: [], conditionVersion: 2, conditionRules: change(viewConditionRules(current)) } : current);
  const section = mode ?? "filters";
  return (
    <Drawer.Backdrop
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      className="theme-modal-backdrop"
      isDismissable
    >
      <Drawer.Content placement="right">
        <Drawer.Dialog className="w-[min(1000px,100vw)] overflow-hidden">
          <Drawer.Header>
            <Drawer.Heading>视图设置</Drawer.Heading>
            <Drawer.CloseTrigger aria-label="关闭视图设置" />
          </Drawer.Header>
          <div className="flex gap-4 my-5">
            <TextField className="w-full flex-1" name="view-name" type="text">
              <Label>视图名称</Label>
              <Input
                value={localViewName}
                onChange={(event) => setLocalViewName(event.target.value)}
                disabled={isDefaultView || isManagingView}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.nativeEvent.isComposing &&
                    canSaveViewName
                  )
                    onSaveViewName(localViewName);
                }}
              />
              {isDefaultView ? (
                <Description className="text-xs text-[var(--color-text-secondary)]">
                  默认视图“全部数据”不支持重命名或删除。
                </Description>
              ) : null}
            </TextField>
            <ButtonGroup>
              <Button
                variant="outline"
                onPress={() => onSaveViewName(localViewName)}
                isDisabled={isDefaultView || isManagingView || !canSaveViewName}
              >
                保存名称
              </Button>
              <Button
                variant="danger"
                onPress={onDeleteView}
                isDisabled={isDefaultView || isManagingView}
              >
                <TrashBin className="size-4" />
                删除视图
              </Button>
            </ButtonGroup>
          </div>

          <Tabs
            variant="secondary"
            selectedKey={section}
            onSelectionChange={(key) =>
              onSectionChange(String(key) as ViewConfigMode)
            }
          >
            <Tabs.ListContainer>
              <Tabs.List aria-label="视图设置分组">
                <Tabs.Tab id="filters">
                  筛选
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id="sorts">
                  排序
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id="fields">
                  显示列
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id="customButtons">
                  自定义按钮
                  <Tabs.Indicator />
                </Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>
          </Tabs>
          <Drawer.Body className="min-h-0 flex-1 overflow-y-auto">
            <MySurface className="min-h-full p-1">
              {draft && section === "customButtons" ? (
                <ViewCustomButtonBindings
                  appId={appId}
                  formUuid={formUuid}
                  bindings={draft.customButtons ?? []}
                  onChange={(customButtons) =>
                    setDraft((current) =>
                      current ? { ...current, customButtons } : current,
                    )
                  }
                />
              ) : null}
              {draft && section === "filters" ? (
                <div className="space-y-3">
                  {isDetailForm ? <p className="text-sm text-[var(--color-text-secondary)]">明细表单暂不支持视图筛选。</p> : <BranchRulesEditor rules={conditionRules} sourceFieldChoices={conditionFields}
                    onAddConditionRule={(parent, sibling, count) => changeConditions(rules => addRule(rules, parent, sibling, count))}
                    onConditionRuleChange={(id, key, value) => changeConditions(rules => updateRule(rules, id, key, value))}
                    onRemoveConditionRule={id => changeConditions(rules => removeRuleTree(rules, id))} />}
                  {conditionError ? <p role="alert" className="text-danger">{conditionError}</p> : null}
                </div>
              ) : null}
              {draft && section === "sorts" ? (
                <div className="space-y-">
                  {draft.sorts.map((rule) => (
                    <div
                      key={rule.id}
                      className="grid grid-cols-[minmax(0,1fr)_130px_36px] items-center gap-2"
                    >
                      <Select
                        selectedKey={rule.fieldId}
                        aria-label="排序字段"
                        onSelectionChange={(key) =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  sorts: current.sorts.map((item) =>
                                    item.id === rule.id
                                      ? {
                                          ...item,
                                          fieldId: String(key ?? ""),
                                        }
                                      : item,
                                  ),
                                }
                              : current,
                          )
                        }
                      >
                        <Select.Trigger>
                          <Select.Value />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            {queryableFields.map((field) => (
                              <ListBox.Item key={field.id} id={field.id}>
                                {field.label}
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                      <Select
                        selectedKey={rule.direction}
                        aria-label="排序方向"
                        onSelectionChange={(key) =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  sorts: current.sorts.map((item) =>
                                    item.id === rule.id
                                      ? {
                                          ...item,
                                          direction: String(key) as
                                            | "asc"
                                            | "desc",
                                        }
                                      : item,
                                  ),
                                }
                              : current,
                          )
                        }
                      >
                        <Select.Trigger>
                          <Select.Value />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            <ListBox.Item id="asc">升序</ListBox.Item>
                            <ListBox.Item id="desc">降序</ListBox.Item>
                          </ListBox>
                        </Select.Popover>
                      </Select>
                      <Button
                        isIconOnly
                        variant="ghost"
                        aria-label="删除排序规则"
                        onPress={() =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  sorts: current.sorts.filter(
                                    (item) => item.id !== rule.id,
                                  ),
                                }
                              : current,
                          )
                        }
                      >
                        <TrashBin />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    onPress={() =>
                      setDraft((current) =>
                        current
                          ? {
                              ...current,
                              sorts: [
                                ...current.sorts,
                                {
                                  id: `sort-${Date.now()}`,
                                  fieldId: allFields[0]?.id ?? "",
                                  direction: "asc",
                                },
                              ],
                            }
                          : current,
                      )
                    }
                  >
                    + 添加排序规则
                  </Button>
                </div>
              ) : null}
              {draft && section === "fields" ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted">
                    使用图钉冻结列到左侧；冻结列与普通列只能在各自分组内拖拽排序。
                  </p>
                  <div className="flex flex-wrap items-end gap-3">
                    <SearchField
                      aria-label="搜索字段名称"
                      value={fieldSearch}
                      onChange={setFieldSearch}
                      className="min-w-56 flex-1"
                    >
                      <Label>字段搜索</Label>
                      <SearchField.Group>
                        <SearchField.SearchIcon />
                        <SearchField.Input placeholder="搜索字段名称" />
                        <SearchField.ClearButton aria-label="清除字段搜索" />
                      </SearchField.Group>
                    </SearchField>
                    <Select
                      aria-label="按字段类型筛选"
                      selectedKey={fieldTypeFilter}
                      onSelectionChange={(key) =>
                        setFieldTypeFilter(String(key ?? "all"))
                      }
                      className="w-52"
                    >
                      <Label>字段类型</Label>
                      <Select.Trigger>
                        <Select.Value>
                          {fieldTypeFilter === "all"
                            ? "全部类型"
                            : fieldTypeOptions.find(
                                ([type]) => type === fieldTypeFilter,
                              )?.[1] ?? "全部类型"}
                        </Select.Value>
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox aria-label="字段类型选项">
                          <ListBox.Item id="all">全部类型</ListBox.Item>
                          {fieldTypeOptions.map(([type, label]) => (
                            <ListBox.Item key={type} id={type}>
                              {label}
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                    <Button
                      variant="outline"
                      isDisabled={Object.keys(draft.columnWidths ?? {}).length === 0}
                      onPress={() =>
                        setDraft((current) =>
                          current ? { ...current, columnWidths: {} } : current,
                        )
                      }
                    >
                      清空所有列宽
                    </Button>
                  </div>
                  <ViewFieldsDragContext
                    sensors={sensors}
                    onDragEnd={handleDragEnd}
                  >
                    <Table>
                      <Table.ScrollContainer>
                        <Table.Content
                          aria-label="显示列设置"
                          treeColumn="viewFieldLabel"
                          expandedKeys={expandedKeysForDisplay}
                          onExpandedChange={setExpandedFieldKeys}
                        >
                          <Table.Header>
                            <Table.Column id="viewFieldLabel" isRowHeader>
                              字段
                            </Table.Column>
                            <Table.Column>字段类型</Table.Column>
                            <Table.Column>显示列</Table.Column>
                            <Table.Column>排序按钮</Table.Column>
                            <Table.Column>宽</Table.Column>
                            <Table.Column>操作</Table.Column>
                          </Table.Header>
                          <Table.Body>
                            {visibleDraftFields.map((field) => (
                              <ReorderableViewFieldRow
                                key={field.id}
                                field={field}
                                config={draft}
                                isDragDisabled={isFieldFilterActive}
                                onConfigChange={
                                  (next) => setDraft(next)
                                }
                              />
                            ))}
                            {visibleDraftFields.length === 0 ? (
                              <Table.Row>
                                <Table.Cell colSpan={6}>
                                  没有匹配的字段
                                </Table.Cell>
                              </Table.Row>
                            ) : null}
                          </Table.Body>
                        </Table.Content>
                      </Table.ScrollContainer>
                    </Table>
                  </ViewFieldsDragContext>
                </div>
              ) : null}
            </MySurface>
          </Drawer.Body>
          <Drawer.Footer className="flex justify-end gap-3">
            <Button variant="ghost" onPress={onClose}>
              取消
            </Button>
            <Button
              isDisabled={!draft || !!conditionError}
              onPress={() => draft && onApply(draft)}
            >
              应用调整
            </Button>
          </Drawer.Footer>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}
