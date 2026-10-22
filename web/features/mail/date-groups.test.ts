import { expect, it } from "vitest";
import { groupMailByDate } from "./date-groups";
import type { MailListItem } from "./model";

const mail = (id: string, date: Date | string): MailListItem => ({ id, sender: "a@example.com", recipient: "b@example.com", subject: id, sentAt: typeof date === "string" ? date : date.toISOString(), isRead: true, isStarred: false });

it("groups all periods in order without duplicating overlapping dates", () => {
  const now = new Date(2026, 9, 22, 15);
  const dates = [new Date(2026, 9, 22), new Date(2026, 9, 21), new Date(2026, 9, 20), new Date(2026, 9, 19), new Date(2026, 9, 15), new Date(2026, 9, 5), new Date(2026, 8, 15), new Date(2026, 2, 1), new Date(2025, 11, 1)];
  const groups = groupMailByDate(dates.map((date, index) => mail(String(index), date)).reverse(), now);
  expect(groups.map(group => group.label)).toEqual(["今天", "昨天", "前天", "本周", "上周", "本月", "上月", "今年", "很久之前"]);
  expect(groups.map(group => group.items.length)).toEqual(Array(9).fill(1));
});

it("uses calendar days across year boundaries and puts yesterday before last week", () => {
  const groups = groupMailByDate([mail("yesterday", new Date(2023, 11, 31, 23)), mail("last-month", new Date(2023, 11, 20))], new Date(2024, 0, 1, 1));
  expect(groups.map(group => group.label)).toEqual(["昨天", "上月"]);
});

it("merges appended pages, sorts newest first, hides empty groups and retains invalid dates", () => {
  const groups = groupMailByDate([mail("older", new Date(2026, 9, 22, 1)), mail("newer", new Date(2026, 9, 22, 10)), mail("invalid", "invalid")], new Date(2026, 9, 22, 15));
  expect(groups.map(group => group.label)).toEqual(["今天", "很久之前"]);
  expect(groups[0].items.map(item => item.id)).toEqual(["newer", "older"]);
  expect(groupMailByDate([])).toEqual([]);
});
