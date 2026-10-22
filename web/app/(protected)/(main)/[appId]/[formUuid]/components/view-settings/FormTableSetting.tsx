"use client";

import {
  DndContext,
  type DragEndEvent,
  type SensorDescriptor,
  type SensorOptions,
} from "@dnd-kit/core";
import {
  Button,
  Drawer,
  Input,
  ListBox,
  Select,
  Table,
  Tabs,
  TextField,
  Label,
  Description,
  ButtonGroup,
} from "@heroui/react";
import { TrashBin } from "@gravity-ui/icons";
import type { Dispatch, SetStateAction } from "react";
import { MySurface } from "@shared/ui/MySurface";
import {
  ReorderableViewFieldRow,
  type ViewFieldOption,
} from "./ViewConfigComponents";
import type { ViewConfig, ViewConfigMode } from "../../model/use-form-views";

import { ViewCustomButtonBindings } from "@/components/ViewCustomButtonBindings";

type Props = {
  appId: string;
  viewName: string;
  isDefaultView: boolean;
  isManagingView: boolean;
  onViewNameChange: (name: string) => void;
  onSaveViewName: () => void;
  onDeleteView: () => void;
  canSaveViewName: boolean;
  formUuid: string;
  isOpen: boolean;
  mode: ViewConfigMode | null;
  draft: ViewConfig | null;
  setDraft: Dispatch<SetStateAction<ViewConfig | null>>;
  onOpenChange: (open: boolean) => void;
  onSectionChange: (section: ViewConfigMode) => void;
  onClose: () => void;
  onApply: () => void;
  allFields: ViewFieldOption[];
  queryableFields: ViewFieldOption[];
  orderedFields: ViewFieldOption[];
  sensors: SensorDescriptor<SensorOptions>[];
  onDragEnd: (event: DragEndEvent) => void;
};

export function FormTableSetting({
  appId,
  formUuid,
  viewName,
  isDefaultView,
  isManagingView,
  onViewNameChange,
  onSaveViewName,
  onDeleteView,
  canSaveViewName,
  isOpen,
  mode,
  draft,
  setDraft,
  onOpenChange,
  onSectionChange,
  onClose,
  onApply,
  allFields,
  queryableFields,
  orderedFields,
  sensors,
  onDragEnd,
}: Props) {
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
            <TextField
              className="w-full flex-1"
              name="view-name"
              type="text"
            >
              <Label>视图名称</Label>
              <Input
                value={viewName}
                onChange={(event) => onViewNameChange(event.target.value)}
                disabled={isDefaultView || isManagingView}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.nativeEvent.isComposing &&
                    canSaveViewName
                  )
                    onSaveViewName();
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
                onPress={onSaveViewName}
                isDisabled={
                  isDefaultView || isManagingView || !canSaveViewName
                }
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
                  {draft.filters.map((rule) => (
                    <div
                      key={rule.id}
                      className="grid grid-cols-[minmax(0,1fr)_130px_minmax(0,1fr)_36px] items-center gap-2"
                    >
                      <Select
                        selectedKey={rule.fieldId}
                        aria-label="筛选字段"
                        onSelectionChange={(key) =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  filters: current.filters.map((item) =>
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
                        selectedKey={rule.operator}
                        aria-label="筛选条件"
                        onSelectionChange={(key) =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  filters: current.filters.map((item) =>
                                    item.id === rule.id
                                      ? {
                                          ...item,
                                          operator: String(
                                            key,
                                          ) as ViewConfig["filters"][number]["operator"],
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
                            {[
                              ["contains", "包含"],
                              ["equals", "等于"],
                              ["notEquals", "不等于"],
                              ["greaterThan", "大于"],
                              ["lessThan", "小于"],
                            ].map(([id, label]) => (
                              <ListBox.Item key={id} id={id}>
                                {label}
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                      <Input
                        aria-label="筛选值"
                        value={rule.value}
                        placeholder="请输入值"
                        onChange={(event) =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  filters: current.filters.map((item) =>
                                    item.id === rule.id
                                      ? { ...item, value: event.target.value }
                                      : item,
                                  ),
                                }
                              : current,
                          )
                        }
                      />
                      <Button
                        isIconOnly
                        variant="ghost"
                        aria-label="删除筛选条件"
                        onPress={() =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  filters: current.filters.filter(
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
                              filters: [
                                ...current.filters,
                                {
                                  id: `filter-${Date.now()}`,
                                  fieldId: queryableFields[0]?.id ?? "",
                                  operator: "contains",
                                  value: "",
                                },
                              ],
                            }
                          : current,
                      )
                    }
                  >
                    + 添加筛选条件
                  </Button>
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
                  <Table>
                    <Table.ScrollContainer>
                      <Table.Content aria-label="显示列设置">
                        <Table.Header>
                          <Table.Column isRowHeader>字段</Table.Column>
                          <Table.Column>字段类型</Table.Column>
                          <Table.Column>显示列</Table.Column>
                          <Table.Column>排序按钮</Table.Column>
                          <Table.Column>宽</Table.Column>
                          <Table.Column>操作</Table.Column>
                        </Table.Header>
                        <Table.Body>
                          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
                            {orderedFields.map((field) => (
                              <ReorderableViewFieldRow
                                key={field.id}
                                field={field}
                                config={draft}
                                onConfigChange={
                                  setDraft as (next: ViewConfig) => void
                                }
                              />
                            ))}
                          </DndContext>
                        </Table.Body>
                      </Table.Content>
                    </Table.ScrollContainer>
                  </Table>
                </div>
              ) : null}
            </MySurface>
          </Drawer.Body>
          <Drawer.Footer className="flex justify-end gap-3">
            <Button variant="ghost" onPress={onClose}>
              取消
            </Button>
            <Button
              onPress={onApply}
            >
              应用调整
            </Button>
          </Drawer.Footer>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}
