"use client";

import { Button, Input, Select, ListBox } from "@heroui/react";
import { Modal } from "@heroui/react/modal";
import { ROOT_PARENT_VALUE } from "./constants";
import type { useFormSidebar } from "./useFormSidebar";

type Props = Pick<ReturnType<typeof useFormSidebar>, "selectedForm" | "formAction" | "closeFormAction" | "formActionPending" | "formActionValue" | "setFormActionValue" | "groupOptions" | "handleFormAction">;

export function FormActionModal({ selectedForm, formAction, closeFormAction, formActionPending, formActionValue, setFormActionValue, groupOptions, handleFormAction }: Props) {
  return (
        <Modal.Backdrop
          isOpen={Boolean(selectedForm && formAction)}
          onOpenChange={(open) => !open && closeFormAction()}
          className="theme-modal-backdrop"
          isDismissable={!formActionPending}
        >
          <Modal.Container placement="center" size="md">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>
                  {formAction === "rename"
                    ? "修改表单名称"
                    : formAction === "move"
                      ? "移动表单"
                      : "删除表单"}
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body className="space-y-4">
                {formAction === "rename" ? (
                  <Input
                    aria-label="表单名称"
                    value={formActionValue}
                    onChange={(event) =>
                      setFormActionValue(event.currentTarget.value)
                    }
                  />
                ) : null}
                {formAction === "move" ? (
                  <Select
                    aria-label="移动到"
                    selectedKey={formActionValue}
                    onSelectionChange={(key) =>
                      setFormActionValue(String(key ?? ROOT_PARENT_VALUE))
                    }
                  >
                    <Select.Trigger>
                      <Select.Value>
                        {formActionValue === ROOT_PARENT_VALUE
                          ? "顶级"
                          : (groupOptions.find(
                              (item) => item.id === formActionValue,
                            )?.label ?? "顶级")}
                      </Select.Value>
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        <ListBox.Item id={ROOT_PARENT_VALUE} textValue="顶级">
                          顶级
                        </ListBox.Item>
                        {groupOptions.map((item) => (
                          <ListBox.Item
                            key={item.id}
                            id={item.id}
                            textValue={item.label}
                          >
                            {item.label}
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                ) : null}
                {formAction === "delete" ? (
                  <p className="">
                    确定永久删除表单“{selectedForm?.title}”吗？表单
                    Schema、记录、导航、视图及关联流程数据将一并删除，此操作不可恢复。
                  </p>
                ) : null}
              </Modal.Body>
              <Modal.Footer className="">
                <Button
                  onClick={closeFormAction}
                  isDisabled={formActionPending}
                >
                  取消
                </Button>
                <Button
                  onClick={handleFormAction}
                  isDisabled={
                    formActionPending ||
                    (formAction === "rename" && !formActionValue.trim())
                  }
                  className={
                    formAction === "delete"
                      ? "bg-[var(--color-danger)] text-white"
                      : "bg-[var(--color-primary)] text-[var(--color-text-on-primary)]"
                  }
                >
                  {formAction === "delete" ? "删除" : "确定"}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
  );
}
