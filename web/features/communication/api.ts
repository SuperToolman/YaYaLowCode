import { getCommunicationStatus } from "@/shared/lib/http";
import { unwrapApiResult } from "@/shared/lib/api-request";
import { uploadFile } from "@/features/files/api";

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
} from "@/shared/lib/http";

export type {
  CommunicationConversationResponse,
  CommunicationMessageResponse,
  CommunicationUserResponse,
} from "@/shared/lib/http";

export async function getCommunicationAvailability() { return unwrapApiResult(await getCommunicationStatus()); }
export function uploadCommunicationFile(file: File) { return uploadFile(file); }
