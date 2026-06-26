export type SystemPageDefinition = {
  slug: string;
  title: string;
  description: string;
};

export const SYSTEM_PAGES: SystemPageDefinition[] = [
  {
    slug: "todo",
    title: "待我处理",
    description: "当前应用下等待我处理的任务。",
  },
  {
    slug: "processed",
    title: "我处理的",
    description: "当前应用下我已经处理过的任务。",
  },
  {
    slug: "created",
    title: "我创建的",
    description: "当前应用下由我发起的数据和流程。",
  },
  {
    slug: "copied",
    title: "抄送我的",
    description: "当前应用下抄送给我的通知与记录。",
  },
];

export function isSystemPageSlug(slug: string) {
  return SYSTEM_PAGES.some((item) => item.slug === slug);
}

export function getSystemPageBySlug(slug: string) {
  return SYSTEM_PAGES.find((item) => item.slug === slug);
}
