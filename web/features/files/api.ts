import { uploadFile as upload } from "@lib/http";
import { unwrapApiResult } from "@lib/api-request";
export async function uploadFile(file: File) {
  return unwrapApiResult(await upload({ body: { file } }));
}
