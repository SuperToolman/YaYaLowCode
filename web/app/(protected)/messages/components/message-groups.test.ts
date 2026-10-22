import { describe, expect, it } from "vitest";
import { formatMessageDividerTime, groupMessages } from "./message-groups";

const message = (id: string, senderUserId: string, createdAt: string) => ({
  id,
  senderUserId,
  createdAt,
});

describe("message display groups", () => {
  it("keeps messages together through 26 minutes and splits after that", () => {
    const entries = groupMessages([
      message("one", "alice", "2026-10-06T10:00:00"),
      message("two", "alice", "2026-10-06T10:26:00"),
      message("three", "alice", "2026-10-06T10:52:01"),
    ]);

    expect(entries.map((entry) => entry.showTimeDivider)).toEqual([
      true,
      false,
      true,
    ]);
    expect(entries.map((entry) => entry.showSenderIdentity)).toEqual([
      true,
      false,
      true,
    ]);
  });

  it("shows identity again when the sender changes", () => {
    const entries = groupMessages([
      message("one", "alice", "2026-10-06T10:00:00"),
      message("two", "alice", "2026-10-06T10:01:00"),
      message("three", "bob", "2026-10-06T10:02:00"),
      message("four", "bob", "2026-10-06T10:03:00"),
    ]);

    expect(entries.map((entry) => entry.showSenderIdentity)).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });

  it("starts a new time group even when one sender keeps sending within 26-minute intervals", () => {
    const entries = groupMessages([
      message("one", "alice", "2026-10-06T10:00:00"),
      message("two", "alice", "2026-10-06T10:20:00"),
      message("three", "alice", "2026-10-06T10:25:00"),
      message("four", "alice", "2026-10-06T10:40:00"),
      message("five", "alice", "2026-10-06T10:55:00"),
    ]);
    expect(entries.map(entry => entry.showTimeDivider)).toEqual([true, false, false, true, false]);
    expect(entries.map(entry => entry.showSenderIdentity)).toEqual([true, false, false, true, false]);
  });

  it("splits after 55 minutes of inactivity for the same sender", () => {
    const entries = groupMessages([
      message("one", "alice", "2026-10-06T10:00:00"),
      message("two", "alice", "2026-10-06T10:55:00"),
    ]);
    expect(entries[1].showTimeDivider).toBe(true);
    expect(entries[1].showSenderIdentity).toBe(true);
  });

  it("does not restart the time window when the sender changes", () => {
    const entries = groupMessages([
      message("one", "alice", "2026-10-06T10:00:00"),
      message("two", "bob", "2026-10-06T10:25:00"),
      message("three", "alice", "2026-10-06T10:27:00"),
    ]);
    expect(entries.map(entry => entry.showTimeDivider)).toEqual([true, false, true]);
  });

  it("formats recent messages relative to the supplied current time", () => {
    const now = new Date(2026, 9, 6, 18, 6, 30).getTime();
    expect(formatMessageDividerTime(new Date(now - 30_000).toISOString(), now)).toBe("刚刚");
    expect(formatMessageDividerTime(new Date(now - 5 * 60_000).toISOString(), now)).toBe("5分钟前");
    expect(formatMessageDividerTime(new Date(2026, 9, 6, 16, 6).toISOString(), now)).toBe("16:06");
  });

  it("formats yesterday, older dates, and dates more than a year ago", () => {
    const now = new Date(2026, 9, 6, 18, 6).getTime();
    expect(formatMessageDividerTime(new Date(2026, 9, 5, 18, 6).toISOString(), now)).toBe("昨天 18:06");
    expect(formatMessageDividerTime(new Date(2026, 8, 29, 11, 25).toISOString(), now)).toBe("09月29日 11:25");
    expect(formatMessageDividerTime(new Date(2024, 8, 29, 11, 25).toISOString(), now)).toBe("2024年 09月29日 11:25");
  });

  it("returns an empty label for invalid dates", () => {
    expect(formatMessageDividerTime("invalid")).toBe("");
  });
});
