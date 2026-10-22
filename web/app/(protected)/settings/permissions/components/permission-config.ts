export const formActions = [
  "display",
  "create",
  "edit",
  "delete",
  "change_log",
  "comment",
  "import",
  "export",
  "bulk_edit",
  "bulk_delete",
  "batch_print",
  "create_view",
] as const;
export const appActions = [
  "display",
  "edit_info",
  "create_group",
  "automation",
  "settings",
  "publish",
  "create_form",
  "edit_form",
  "delete_form",
  "view_development",
] as const;
export const actionLabels: Record<string, string> = {
  display: "查看",
  create: "新增",
  edit: "编辑",
  delete: "删除",
  change_log: "变更记录",
  comment: "评论",
  import: "批量导入",
  export: "批量导出",
  bulk_edit: "批量修改",
  bulk_delete: "批量删除",
  batch_print: "批量打印",
  create_view: "创建视图",
};
export const appActionLabels: Record<(typeof appActions)[number], string> = {
  display: "查看应用",
  edit_info: "编辑应用信息",
  create_group: "创建分组",
  automation: "集成自动化",
  settings: "应用设置",
  publish: "应用发布",
  create_form: "创建表单",
  edit_form: "编辑表单",
  delete_form: "删除表单",
  view_development: "全部表单视图操作",
};
export const applicationDevelopmentActions = [
  "edit_info",
  "create_group",
  "automation",
  "settings",
  "publish",
] as const;
export const formDevelopmentActions = [
  "create_form",
  "edit_form",
  "delete_form",
] as const;
export const formActionGroups = [
  ["常用操作", ["display", "create", "edit", "delete"]],
  ["详情页操作", ["change_log", "comment"]],
] as const;
export { platformPermissionGroups } from "@/features/identity-access/platform-permissions";
