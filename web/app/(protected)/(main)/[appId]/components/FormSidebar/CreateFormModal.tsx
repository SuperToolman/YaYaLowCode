"use client";

import { Button, Input, Label } from "@heroui/react";
import { Modal } from "@heroui/react/modal";
import type { useFormSidebar } from "./useFormSidebar";

type Props = Pick<
  ReturnType<typeof useFormSidebar>,
  | "createFormOpen"
  | "closeCreateForm"
  | "createFormType"
  | "createFormName"
  | "setCreateFormName"
  | "submitCreateForm"
  | "createFormSubmitting"
>;

const formTypeNames = {
  normal: "普通表单",
  defined: "自定义页面",
  workflow: "流程表单",
} as const;

export function CreateFormModal({
  createFormOpen,
  closeCreateForm,
  createFormType,
  createFormName,
  setCreateFormName,
  submitCreateForm,
  createFormSubmitting,
}: Props) {
  return (
    <Modal.Backdrop
      isOpen={createFormOpen}
      onOpenChange={(open) => !open && closeCreateForm()}
      isDismissable={!createFormSubmitting}
    >
      <Modal.Container placement="center" size="md">
        <Modal.Dialog>
          <Modal.Header>
            <Modal.Heading>创建{formTypeNames[createFormType]}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <div className="flex flex-col gap-2">
              <Label htmlFor="create-form-name">表单名称</Label>
              <Input
                id="create-form-name"
                placeholder="未命名表单"
                value={createFormName}
                disabled={createFormSubmitting}
                onChange={(event) =>
                  setCreateFormName(event.currentTarget.value)
                }
              />
              <p className="m-0 text-xs text-muted">
                可选，留空时使用“未命名表单”。
              </p>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button
              onPress={closeCreateForm}
              isDisabled={createFormSubmitting}
            >
              取消
            </Button>
            <Button
              onPress={submitCreateForm}
              isDisabled={createFormSubmitting}
            >
              {createFormSubmitting ? "正在创建…" : "创建"}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
