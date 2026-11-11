import { uploadFile as upload } from "@/shared/lib/http";
import { unwrapApiResult } from "@/shared/lib/api-request";
export async function uploadFile(file: File) {
  return unwrapApiResult(await upload({ body: { file } }));
}
