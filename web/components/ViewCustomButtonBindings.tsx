"use client";
import { notifyRequestError } from "@lib/notify";


import { useEffect, useMemo, useState } from "react";
import {
  Button,
  ButtonGroup,
  Dropdown,
  Pagination,
  SearchField,
  Table,
} from "@heroui/react";
import { Modal } from "@heroui/react/modal";
import { Gear, Pencil, Plus, TrashBin } from "@gravity-ui/icons";
import { notify } from "@lib/notify";
import { CustomButtonConfigModal } from "./CustomButtonConfigModal";
import { getBindingOptions, removeButton, saveButton } from "@/features/custom-buttons/api";
import {
  newBinding,
  type ButtonBinding,
} from "@/features/custom-buttons/bindings";
import { emptyDraft, type ButtonDefinition } from "@/features/custom-buttons/model";

const PAGE_SIZE = 10;

export function ViewCustomButtonBindings({
  appId,
  formUuid,
  bindings,
  onChange,
}: {
  appId: string;
  formUuid: string;
  bindings: ButtonBinding[];
  onChange: (bindings: ButtonBinding[]) => void;
}) {
  const [options, setOptions] = useState<ButtonDefinition[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [createButtonOpen, setCreateButtonOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [managedButton, setManagedButton] = useState<ButtonDefinition | null>(null);
  const [deleteManagedButton, setDeleteManagedButton] = useState<ButtonDefinition | null>(null);

  useEffect(() => {
    let active = true;
    getBindingOptions(formUuid)
      .then((items) => {
        if (active) setOptions(items);
      })
      .catch((error) => {
        if (active) notifyRequestError(error, error.message || "加载按钮失败");
      });
    return () => {
      active = false;
    };
  }, [formUuid]);

  const filteredBindings = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    if (!keyword) return bindings;
    return bindings.filter((binding) => {
      const button = options.find((item) => item.id === binding.buttonId);
      const text = [
        button?.name,
        button?.targetFormName,
        button?.disabledReason,
        button?.availability.mode === "all" ? "全部数据" : "满足筛选条件",
      ]
        .filter(Boolean)
        .join(" ");
      return text.toLocaleLowerCase("zh-CN").includes(keyword);
    });
  }, [bindings, options, query]);
  const pageCount = Math.max(1, Math.ceil(filteredBindings.length / PAGE_SIZE));
  const visibleBindings = filteredBindings.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );
  function bind(buttonId: string) {
    if (bindings.some((binding) => binding.buttonId === buttonId)) return;
    onChange([...bindings, newBinding(buttonId)]);
    notify.success("绑定已添加，请保存视图配置");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchField
          aria-label="搜索自定义按钮绑定"
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPage(1);
          }}
          className="w-64"
        >
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="搜索自定义按钮" />
            <SearchField.ClearButton aria-label="清除搜索" />
          </SearchField.Group>
        </SearchField>
        <ButtonGroup variant="tertiary">
          <Button onPress={() => setManageOpen(true)}>
            <Gear />
            管理按钮
          </Button>
          <Dropdown>
            <Button><Plus />新增绑定</Button>
            <Dropdown.Popover>
              <Dropdown.Menu aria-label="选择未绑定的自定义按钮" onAction={(key) => {
                if (key === "create-button") setCreateButtonOpen(true);
                else bind(String(key));
              }}>
                {options.filter((option) => !bindings.some((binding) => binding.buttonId === option.id)).map((option) => (
                  <Dropdown.Item key={option.id} id={option.id} textValue={option.name}>{option.name}</Dropdown.Item>
                ))}
                <Dropdown.Item id="create-button" textValue="新建自定义按钮" className="border-t border-separator"><Plus />新建自定义按钮</Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </ButtonGroup>
      </div>
      <Table variant="primary" className="overflow-hidden">
        <Table.ScrollContainer>
          <Table.Content aria-label="自定义按钮绑定列表">
            <Table.Header>
              <Table.Column id="name" isRowHeader>
                按钮名称
              </Table.Column>
              <Table.Column id="actions">操作</Table.Column>
            </Table.Header>
            <Table.Body
              renderEmptyState={() => (
                <p className="p-8 text-center text-muted">
                  {query
                    ? "没有匹配的自定义按钮"
                    : "当前视图尚未绑定自定义按钮"}
                </p>
              )}
            >
              <Table.Collection items={visibleBindings}>
                {(binding) => {
                  const button = options.find(
                    (option) => option.id === binding.buttonId,
                  );
                  return (
                    <Table.Row id={binding.buttonId}>
                      <Table.Cell>
                        <strong>
                          {button?.name || `失效按钮：${binding.buttonId}`}
                        </strong>
                      </Table.Cell>
                      <Table.Cell className="whitespace-nowrap">
                        <ButtonGroup size="sm" variant="tertiary">
                          <Button isDisabled={!button} onPress={() => { if (button) setManagedButton(button); }}>
                            <Pencil />编辑按钮
                          </Button>
                          <Button
                            className="text-[var(--color-danger)]"
                            onPress={() => setRemoveTarget(binding.buttonId)}
                          >
                            <ButtonGroup.Separator />
                            <TrashBin />
                            移除
                          </Button>
                        </ButtonGroup>
                      </Table.Cell>
                    </Table.Row>
                  );
                }}
              </Table.Collection>
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
        <Table.Footer>
          <Pagination
            size="sm"
            aria-label="自定义按钮绑定分页"
            className="w-full"
          >
            <Pagination.Summary>
              共 {filteredBindings.length} 个绑定，每页 {PAGE_SIZE} 个
            </Pagination.Summary>
            <Pagination.Content>
              <Pagination.Item>
                <Pagination.Previous
                  aria-label="上一页"
                  isDisabled={page === 1}
                  onPress={() => setPage(page - 1)}
                >
                  <Pagination.PreviousIcon />
                  上一页
                </Pagination.Previous>
              </Pagination.Item>
              {Array.from({ length: pageCount }, (_, index) => index + 1).map(
                (pageNumber) => (
                  <Pagination.Item key={pageNumber}>
                    <Pagination.Link
                      isActive={pageNumber === page}
                      onPress={() => setPage(pageNumber)}
                    >
                      {pageNumber}
                    </Pagination.Link>
                  </Pagination.Item>
                ),
              )}
              <Pagination.Item>
                <Pagination.Next
                  aria-label="下一页"
                  isDisabled={page === pageCount}
                  onPress={() => setPage(page + 1)}
                >
                  下一页
                  <Pagination.NextIcon />
                </Pagination.Next>
              </Pagination.Item>
            </Pagination.Content>
          </Pagination>
        </Table.Footer>
      </Table>

      {createButtonOpen ? (
        <CustomButtonConfigModal
          key={`create-from-view:${formUuid}`}
          appId={appId}
          ownerFormUuid={formUuid}
          mode="create"
          initialDraft={{
            ...emptyDraft(),
          }}
          onClose={() => setCreateButtonOpen(false)}
          onSave={async (draft) => {
            const created = await saveButton(formUuid, undefined, draft);
            setOptions((current) => [
              created,
              ...current.filter((button) => button.id !== created.id),
            ]);
            onChange([...bindings, newBinding(created.id)]);
            setCreateButtonOpen(false);
            notify.success("自定义按钮已创建并绑定，请保存视图配置");
          }}
        />
      ) : null}
      {manageOpen ? (
        <Modal isOpen onOpenChange={(open) => { if (!open) setManageOpen(false); }}>
          <Modal.Backdrop><Modal.Container><Modal.Dialog className="!w-[720px] !max-w-[calc(100vw-2rem)]">
            <Modal.Header><Modal.Heading>管理当前表单的自定义按钮</Modal.Heading><Modal.CloseTrigger /></Modal.Header>
            <Modal.Body>
              <Table><Table.ScrollContainer><Table.Content aria-label="当前表单自定义按钮">
                <Table.Header><Table.Column id="name" isRowHeader>按钮名称</Table.Column><Table.Column id="action">动作类型</Table.Column><Table.Column id="automation">集成自动化</Table.Column><Table.Column id="actions">操作</Table.Column></Table.Header>
                <Table.Body renderEmptyState={() => <p className="p-6 text-center">当前表单还没有自定义按钮</p>}>
                  <Table.Collection items={options}>{(button) => <Table.Row id={button.id}>
                    <Table.Cell>{button.name}</Table.Cell>
                    <Table.Cell>{button.actionType === "run_automation" ? "集成自动化" : button.actionType === "open_page" ? "打开页面" : "填写表单"}</Table.Cell>
                    <Table.Cell>{button.actionType === "run_automation" ? button.actionConfig.automationId : "—"}</Table.Cell>
                    <Table.Cell><ButtonGroup size="sm" variant="tertiary"><Button onPress={() => { setManageOpen(false); setManagedButton(button); }}><Pencil />编辑</Button><Button className="text-[var(--color-danger)]" onPress={() => setDeleteManagedButton(button)}><ButtonGroup.Separator /><TrashBin />删除</Button></ButtonGroup></Table.Cell>
                  </Table.Row>}</Table.Collection>
                </Table.Body>
              </Table.Content></Table.ScrollContainer></Table>
            </Modal.Body>
            <Modal.Footer><Button variant="secondary" onPress={() => setManageOpen(false)}>关闭</Button></Modal.Footer>
          </Modal.Dialog></Modal.Container></Modal.Backdrop>
        </Modal>
      ) : null}
      {managedButton ? <CustomButtonConfigModal key={`edit-form-button:${managedButton.id}`} appId={appId} ownerFormUuid={formUuid} mode="edit" button={managedButton} onClose={() => setManagedButton(null)} onSave={async (draft) => {
        const updated = await saveButton(formUuid, managedButton.id, draft);
        setOptions((current) => current.map((item) => item.id === updated.id ? updated : item));
        setManagedButton(null);
        notify.success("自定义按钮已更新");
      }} /> : null}
      {deleteManagedButton ? <Modal isOpen onOpenChange={(open) => { if (!open) setDeleteManagedButton(null); }}><Modal.Backdrop><Modal.Container><Modal.Dialog><Modal.Header><Modal.Heading>删除自定义按钮</Modal.Heading></Modal.Header><Modal.Body>删除“{deleteManagedButton.name}”后，当前表单中绑定它的视图也将无法继续显示该按钮。</Modal.Body><Modal.Footer><Button variant="secondary" onPress={() => setDeleteManagedButton(null)}>取消</Button><Button className="text-[var(--color-danger)]" onPress={() => { void removeButton(formUuid, deleteManagedButton.id).then(() => { setOptions((current) => current.filter((item) => item.id !== deleteManagedButton.id)); onChange(bindings.filter((binding) => binding.buttonId !== deleteManagedButton.id)); setDeleteManagedButton(null); notify.success("自定义按钮已删除"); }).catch((error) => notifyRequestError(error, error instanceof Error ? error.message : "删除失败")); }}>确认删除</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal> : null}
      {removeTarget ? (
        <Modal
          isOpen
          onOpenChange={(open) => {
            if (!open) setRemoveTarget(null);
          }}
        >
          <Modal.Backdrop>
            <Modal.Container>
              <Modal.Dialog>
                <Modal.Header>
                  <Modal.Heading>移除按钮绑定？</Modal.Heading>
                </Modal.Header>
                <Modal.Body>仅移除当前视图的绑定，保留按钮定义。</Modal.Body>
                <Modal.Footer>
                  <Button
                    variant="secondary"
                    onPress={() => setRemoveTarget(null)}
                  >
                    取消
                  </Button>
                  <Button
                    onPress={() => {
                      onChange(
                        bindings.filter(
                          (binding) => binding.buttonId !== removeTarget,
                        ),
                      );
                      setRemoveTarget(null);
                      notify.success("绑定已移除，请保存视图配置");
                    }}
                  >
                    确认移除
                  </Button>
                </Modal.Footer>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
      ) : null}
    </div>
  );
}
