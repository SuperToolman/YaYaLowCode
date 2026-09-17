import { requestApi } from "@lib/api-request";

export function uploadFile<T>(file: File) {
  const body = new FormData();
  body.append("file", file);
  return requestApi<T>("/api/files/upload", { method: "POST", body });
}
