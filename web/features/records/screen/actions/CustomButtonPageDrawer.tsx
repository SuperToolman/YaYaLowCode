"use client";

import { Button, Drawer } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/components/AuthProvider";
import { notify, notifyRequestError } from "@/shared/lib/notify";
import type { ButtonDefinition } from "@/features/custom-buttons/model";
import { buttonPageParams } from "@/features/custom-buttons/model";
import { fetchCurrentFormSchema } from "@/features/form-runtime/api";
import { RuntimeFormRenderer } from "@/features/form-runtime/components/RuntimeFormRenderer";
import { useRecordMutations } from "@/features/records/mutations";
import { useEmbeddedRecordsPage } from "../embedded-page-context";

export type CustomButtonPageTarget = {
  button: ButtonDefinition;
  url: string;
  record?: { id: string; data: Record<string, unknown> };
};

export function CustomButtonPageDrawer({ target, onClose }: {
  target: CustomButtonPageTarget;
  onClose: () => void;
}) {
  const renderEmbeddedPage = useEmbeddedRecordsPage();
  return (
    <Drawer isOpen onOpenChange={(open) => { if (!open) onClose(); }}>
      <Drawer.Backdrop>
        <Drawer.Content placement="right">
          <Drawer.Dialog className="w-[min(1100px,100vw)]">
            <Drawer.Header>
              <Drawer.Heading>{target.button.targetFormName || target.button.name}</Drawer.Heading>
              <Drawer.CloseTrigger />
            </Drawer.Header>
            <Drawer.Body className="flex min-h-0 flex-1 flex-col">
              {target.button.actionConfig.linkType === "external" ? (
                <iframe title={target.button.name} src={target.url} className="h-[80vh] w-full border-0" />
              ) : !target.record ? (
                <div className="h-full min-h-[60vh] min-w-0 flex-1">
                  {renderEmbeddedPage ? renderEmbeddedPage({
                    appId: target.button.actionConfig.targetAppId,
                    formUuid: target.button.actionConfig.targetFormUuid,
                    embedded: true,
                    readOnly: target.button.actionConfig.pageMode !== "edit",
                    pageParameters: buttonPageParams(target.url, target.button.actionConfig.targetAppId, target.button.actionConfig.targetFormUuid),
                  }) : <p role="alert">表单页面渲染器未配置，请从记录工作区打开。</p>}
                </div>
              ) : (
                <InternalButtonForm
                  key={`${target.button.actionConfig.targetFormUuid}:${target.record?.id ?? ""}:${target.button.actionConfig.pageMode}`}
                  target={target}
                  onClose={onClose}
                />
              )}
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}

function InternalButtonForm({ target, onClose }: { target: CustomButtonPageTarget; onClose: () => void }) {
  const { targetFormUuid, targetAppId, pageMode } = target.button.actionConfig;
  const { hasPermission } = useAuth();
  const schemaQuery = useQuery({
    queryKey: ["custom-button-page-schema", targetFormUuid],
    queryFn: () => fetchCurrentFormSchema(targetFormUuid),
    retry: false,
  });
  const mutations = useRecordMutations(targetFormUuid);
  const readOnly = pageMode !== "edit";
  const canSave = hasPermission(`form:${targetFormUuid}:${target.record ? "edit" : "create"}`);
  const submitting = mutations.create.isPending || mutations.update.isPending;

  if (schemaQuery.isPending) return <p role="status">正在加载表单…</p>;
  if (schemaQuery.isError) return (
    <div className="flex flex-col items-start gap-4">
      <p role="alert">{schemaQuery.error.message || "加载表单失败"}</p>
      <Button variant="secondary" onPress={() => { void schemaQuery.refetch(); }}>重试</Button>
    </div>
  );

  return (
    <>
      {!readOnly && !canSave ? <p role="status" className="mb-4">没有目标表单的操作权限，当前仅可查看。</p> : null}
      <RuntimeFormRenderer
        schema={schemaQuery.data}
        initialValues={target.record?.data}
        recordUuid={target.record?.id}
        readOnlyDisplay={readOnly || !canSave}
        isReadOnly={readOnly || !canSave}
        showSubmitButton={!readOnly && canSave}
        submitLabel={target.record ? "保存" : "提交"}
        submitting={submitting}
        urlParams={buttonPageParams(target.url, targetAppId, targetFormUuid)}
        runLoadActionInReadOnly
        onSubmit={async (values) => {
          if (readOnly || !canSave || submitting) return;
          try {
            if (target.record) await mutations.update.mutateAsync({ recordUuid: target.record.id, values });
            else await mutations.create.mutateAsync(values);
            notify.success(target.record ? "保存成功" : "提交成功");
            onClose();
          } catch (error) {
            notifyRequestError(error, error instanceof Error ? error.message : "保存失败");
          }
        }}
      />
    </>
  );
}
