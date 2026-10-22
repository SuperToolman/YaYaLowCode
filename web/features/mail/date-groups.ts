import type { MailListItem } from "./model";

export const mailDateGroups = [
  "今天",
  "昨天",
  "前天",
  "本周",
  "上周",
  "本月",
  "上月",
  "今年",
  "很久之前",
] as const;

// Use the viewer's local calendar and Monday as the first day of the week.
// Check narrower periods first so every message belongs to exactly one group.
export function groupMailByDate(items: MailListItem[], now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = (offset: number) =>
    new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + offset,
    ).getTime();
  const monday = day(-((today.getDay() + 6) % 7));
  const lastMonday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - ((today.getDay() + 6) % 7) - 7,
  ).getTime();
  const month = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
  const lastMonth = new Date(
    today.getFullYear(),
    today.getMonth() - 1,
    1,
  ).getTime();
  const year = new Date(today.getFullYear(), 0, 1).getTime();
  const groups = mailDateGroups.map((label) => ({
    label,
    items: [] as MailListItem[],
  }));
  for (const item of items) {
    const time = new Date(item.sentAt).getTime();
    const index = !Number.isFinite(time)
      ? 8
      : time >= day(0)
        ? 0
        : time >= day(-1)
          ? 1
          : time >= day(-2)
            ? 2
            : time >= monday
              ? 3
              : time >= lastMonday
                ? 4
                : time >= month
                  ? 5
                  : time >= lastMonth
                    ? 6
                    : time >= year
                      ? 7
                      : 8;
    groups[index].items.push(item);
  }
  for (const group of groups)
    group.items.sort(
      (a, b) => (Date.parse(b.sentAt) || 0) - (Date.parse(a.sentAt) || 0),
    );
  return groups.filter((group) => group.items.length > 0);
}
