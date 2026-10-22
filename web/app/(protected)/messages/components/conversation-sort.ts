import type { CommunicationConversationResponse } from "@features/communication/api";

export function sortConversations(
  conversations: CommunicationConversationResponse[],
): CommunicationConversationResponse[] {
  return conversations
    .map((conversation, index) => ({ conversation, index }))
    .sort((left, right) => {
      const leftTime = parseConversationTime(left.conversation.lastMessageAt);
      const rightTime = parseConversationTime(right.conversation.lastMessageAt);
      if (leftTime === null && rightTime === null) return left.index - right.index;
      if (leftTime === null) return 1;
      if (rightTime === null) return -1;
      return rightTime - leftTime || left.index - right.index;
    })
    .map(({ conversation }) => conversation);
}

function parseConversationTime(value?: string | null): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}
