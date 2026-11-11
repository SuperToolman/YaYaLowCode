export type SystemPageDefinition = {
  slug: string;
  title: string;
  description: string;
};

export const SYSTEM_PAGES: SystemPageDefinition[] = [
  {
    slug: "tasks",
    title: "任务",
    description: "查看所有应用中的待办、已处理、已创建和抄送任务。",
  },
];

const LEGACY_TASK_PAGE_SLUGS = new Set(["todo", "processed", "created", "copied"]);

export function isSystemPageSlug(slug: string) {
  return SYSTEM_PAGES.some((item) => item.slug === slug) || LEGACY_TASK_PAGE_SLUGS.has(slug);
}

export function getSystemPageBySlug(slug: string) {
  return SYSTEM_PAGES.find((item) => item.slug === slug) ?? (LEGACY_TASK_PAGE_SLUGS.has(slug) ? SYSTEM_PAGES[0] : undefined);
}
