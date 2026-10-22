export const MESSAGE_TIME_GAP_MS = 26 * 60 * 1000;

export type MessageGroupEntry<T> = {
  message: T;
  showTimeDivider: boolean;
  showSenderIdentity: boolean;
};

export function groupMessages<T extends { senderUserId: string; createdAt: string }>(
  messages: T[],
): MessageGroupEntry<T>[] {
  let previous: T | undefined;
  let groupStartTime = NaN;

  return messages.map((message) => {
    const currentTime = new Date(message.createdAt).getTime();
    const previousTime = previous ? new Date(previous.createdAt).getTime() : NaN;
    const showTimeDivider =
      !previous ||
      !Number.isFinite(currentTime) ||
      !Number.isFinite(previousTime) ||
      !Number.isFinite(groupStartTime) ||
      currentTime - groupStartTime > MESSAGE_TIME_GAP_MS;
    const showSenderIdentity =
      showTimeDivider || previous?.senderUserId !== message.senderUserId;

    if (showTimeDivider) groupStartTime = currentTime;
    previous = message;
    return { message, showTimeDivider, showSenderIdentity };
  });
}

export function formatMessageDividerTime(value: string, now = Date.now()): string {
  const date = new Date(value);
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) return "";

  const elapsed = now - timestamp;
  if (elapsed >= 0 && elapsed < 60_000) return "刚刚";
  if (elapsed >= 60_000 && elapsed < 60 * 60_000)
    return `${Math.floor(elapsed / 60_000)}分钟前`;

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const time = `${hours}:${minutes}`;
  const nowDate = new Date(now);
  const isSameDay =
    date.getFullYear() === nowDate.getFullYear() &&
    date.getMonth() === nowDate.getMonth() &&
    date.getDate() === nowDate.getDate();
  if (isSameDay) return time;

  const yesterday = new Date(nowDate);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) return `昨天 ${time}`;

  const dateLabel = `${month}月${day}日 ${time}`;
  return nowDate.getFullYear() - date.getFullYear() > 1
    ? `${date.getFullYear()}年 ${dateLabel}`
    : dateLabel;
}
