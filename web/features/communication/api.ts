import { getCommunicationStatus } from "@lib/api-client";
import { ApiRequestError, requestApi, type ApiEnvelope } from "@lib/api-request";
import { uploadFile } from "@features/files/api";

export {
  createDirectConversation,
  createGroupConversation,
  listCommunicationConversations,
  listCommunicationMessages,
  listCommunicationUsers,
  markCommunicationConversationRead,
  recallCommunicationMessage,
  reeditCommunicationMessage,
  sendCommunicationMessage,
  updateGroupConversation,
} from "@/app/lib/api-client";

export type {
  CommunicationConversationResponse,
  CommunicationMessageResponse,
  CommunicationUserResponse,
} from "@/app/lib/api-client";

export async function getCommunicationAvailability<T>() {
  const { data, error } = await getCommunicationStatus({ responseStyle: "fields" });
  if (error || data?.code !== 0 || data.data === null) {
    throw new ApiRequestError(data?.message || "无法加载通讯状态", 0, "business", data?.code, { cause: error });
  }
  return data.data as T;
}

export function uploadCommunicationFile(file: File) {
  return uploadFile<{ fileId: string }>(file);
}
