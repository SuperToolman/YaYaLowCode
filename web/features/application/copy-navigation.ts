import { unwrapApiResult } from "@lib/api-request";
import { createForm, createNavigationGroup, deleteForm, getFormSchema, saveFormSchema } from "@/app/lib/http";

export function nextCopyName(name: string, existingNames: Iterable<string>) {
  const base = name.replace(/(?:\([1-9]\d*\)|（[1-9]\d*）)$/, "");
  const existing = new Set(existingNames);
  let index = 1;
  while (existing.has(`${base}(${index})`) || existing.has(`${base}（${index}）`)) index++;
  return `${base}(${index})`;
}

export async function copyEmptyNavigationGroup(appId: string, name: string, parentId?: string | null) {
  const result = await createNavigationGroup({
    path: { appId }, body: { title: name, parent_id: parentId ?? null }, responseStyle: "fields",
  });
  unwrapApiResult(result, "复制分组失败");
}

export async function copyFormSchema(
  appId: string, sourceFormUuid: string, name: string,
  formType: "normal" | "workflow" | "defined" | "detail" = "normal", parentId?: string | null,
) {
  const source = await getFormSchema({ path: { formUuid: sourceFormUuid }, responseStyle: "fields" });
  const original = unwrapApiResult(source, "无法读取原表单设计").schema;
  if (!original || typeof original !== "object" || Array.isArray(original)) throw new Error("原表单设计格式无效");
  // Detail forms are projections of existing rows. Their copies must own storage.
  const created = await createForm({
    path: { appId }, body: { formType: formType === "detail" ? "normal" : formType, parentId: parentId ?? null }, responseStyle: "fields",
  });
  const formUuid = unwrapApiResult(created, "无法创建表单副本").id;
  try {
    const schema: Record<string, unknown> = { ...structuredClone(original) as Record<string, unknown>, formUuid, formName: name };
    if (formType === "detail" && schema.pageProps && typeof schema.pageProps === "object") {
      const props = schema.pageProps as Record<string, unknown>;
      for (const key of ["detailSourceFormUuid", "detailSubformFieldId", "detailPrimaryDisplayFieldId", "detailSecondaryDisplayFieldId"]) delete props[key];
    }
    const saved = await saveFormSchema({
      path: { formUuid }, body: { schema, base_version: 1, change_log: "复制表单设计" }, responseStyle: "fields",
    });
    unwrapApiResult(saved, "保存副本设计失败");
    return formUuid;
  } catch (error) {
    try {
      const cleanup = await deleteForm({ path: { formUuid }, responseStyle: "fields" });
      unwrapApiResult(cleanup, "cleanup failed");
    } catch {
      throw new Error(`复制未完成，已创建的表单 ${formUuid} 未能清理，请在侧栏检查后删除。`);
    }
    throw error;
  }
}
