"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, toast } from "@heroui/react";
import { Pencil, TrashBin } from "@gravity-ui/icons";
import { RuntimeFormRenderer, type RuntimeFormSchema } from "@/features/form-runtime/components";
import { getForm, getFormSchema } from "@/features/form-runtime/api";
import { useRecordMutations } from "@/features/records/mutations";
import { useAuth } from "@components/AuthProvider";
import { notifyAppNavigationChanged } from "../../components/app-navigation-events";

type Props = { appId: string; formUuid: string };

export function DefinedPageHome({ appId, formUuid }: Props) {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const canEditForm = hasPermission(`app:${appId}:edit_form`);
  const canDeleteForm = hasPermission(`app:${appId}:delete_form`);
  const [schema, setSchema] = useState<RuntimeFormSchema | null>(null);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const recordMutations = useRecordMutations(formUuid);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getForm({ path: { formUuid }, responseStyle: "fields" }),
      getFormSchema({ path: { formUuid }, responseStyle: "fields" }),
    ]).then(([metadataResult, schemaResult]) => {
      if (cancelled) return;
      if (!metadataResult.error && metadataResult.data?.code === 0 && metadataResult.data.data) {
        setName(metadataResult.data.data.name);
      }
      if (!schemaResult.error && schemaResult.data?.code === 0 && schemaResult.data.data?.schema) {
        setSchema(schemaResult.data.data.schema as RuntimeFormSchema);
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [formUuid]);

  async function handleDelete() {
    if (!window.confirm(`确认删除“${name || formUuid}”吗？此操作会同时删除页面数据。`)) return;
    setDeleting(true);
    try {
      await recordMutations.removeForm.mutateAsync();
      notifyAppNavigationChanged(appId);
      toast.success("自定义页面已删除");
      router.replace(`/${appId}`);
    } catch {
      toast.danger("删除自定义页面失败", { description: "请确认后端服务正常。" });
    } finally {
      setDeleting(false);
    }
  }

  if (!schema) return <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-[var(--color-text-secondary)]">正在加载自定义页面...</div>;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <Card className="theme-card-glass flex h-14 w-full shrink-0 flex-row items-center justify-between rounded-xl px-5">
        <h1 className="min-w-0 truncate text-base font-semibold text-[var(--color-text-primary)]">{name || schema.formName || formUuid}</h1>
        <div className="flex shrink-0 items-center gap-2">
          {canEditForm ? <Button variant="secondary" size="sm" onPress={() => router.push(`/designer/${formUuid}?appId=${appId}`)}><Pencil className="h-4 w-4" />编辑表单</Button> : null}
          {canDeleteForm ? <Button variant="ghost" size="sm" className="text-[var(--color-danger)]" isDisabled={deleting} onPress={() => void handleDelete()}><TrashBin className="h-4 w-4" />{deleting ? "删除中..." : "删除表单"}</Button> : null}
        </div>
      </Card>
      <main className="theme-card-glass min-h-0 w-full flex-1 overflow-auto rounded-xl p-5">
        <RuntimeFormRenderer schema={schema} submitLabel="" showSubmitButton={false} onSubmit={() => undefined} />
      </main>
    </div>
  );
}
