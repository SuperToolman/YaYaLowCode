import { describe, expect, it } from "vitest";
import { collectNewWorkflowNotices, type WorkflowNotice } from "./workflow-toast-state";

const startedAt = Date.parse("2026-09-30T10:00:00Z");
const notice = (id: string, type: string, createdAt: string): WorkflowNotice => ({
  id, type, createdAt, title: id, content: "流程提醒",
});

describe("collectNewWorkflowNotices", () => {
  it("ignores history and reports new task/copy events only once", () => {
    const seen = new Set<string>();
    const history = notice("old", "task", "2026-09-30T09:59:59Z");
    const task = notice("task", "task", "2026-09-30T10:00:01Z");
    const copy = notice("copy", "copy", "2026-09-30T10:00:02Z");
    const other = notice("other", "approval_result", "2026-09-30T10:00:03Z");

    expect(collectNewWorkflowNotices(seen, [history, task, copy, other], startedAt)).toEqual([task, copy]);
    expect(collectNewWorkflowNotices(seen, [history, task, copy, other], startedAt)).toEqual([]);
  });
});
