import { getFormSchema } from "@/shared/lib/http";
import { unwrapApiResult } from "@/shared/lib/api-request";

/** Fetch a schema through an explicit domain decoder, without importing an editor. */
export async function getDesignerSchema<TSchema>(formUuid: string, decode: (schema: unknown) => TSchema) {
  const { data, error, response } = await getFormSchema({ path: { formUuid }, responseStyle: "fields" });
  const payload = unwrapApiResult({ data, error, response }, "无法加载表单 Schema");
  return { ...payload, schema: decode(payload.schema) };
}
