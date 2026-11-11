export type WorkflowNotice = {
  id: string;
  type: string;
  title: string;
  content: string;
  createdAt: string;
};

export function collectNewWorkflowNotices(seen: Set<string>, items: WorkflowNotice[], startedAt: number) {
  const fresh: WorkflowNotice[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if ((item.type === "task" || item.type === "copy") && Date.parse(item.createdAt) > startedAt) {
      fresh.push(item);
    }
  }
  return fresh;
}
