import { getCommunicationStatus } from "@lib/http";
import { unwrapApiResult } from "@lib/api-request";
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
} from "@/app/lib/http";

export type {
  CommunicationConversationResponse,
  CommunicationMessageResponse,
  CommunicationUserResponse,
} from "@/app/lib/http";

export async function getCommunicationAvailability() { return unwrapApiResult(await getCommunicationStatus()); }
export function uploadCommunicationFile(file: File) { return uploadFile(file); }
