export type Role = {
  id: string;
  name: string;
  sourceType: string;
  externalId: string;
  status: string;
  memberCount: number;
};
export type App = { id: string; name: string };
export type Agent = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
};
export type AiEmployeeMarketItem = {
  id: string;
  title: string;
  installed: boolean;
  expiresAt: number | null;
};
export type ApiEnvelope<T> = { code: number; message: string; data: T | null };
export type NavigationItem = {
  id: string;
  itemType: "group" | "form" | string;
  targetFormUuid: string | null;
  title: string;
  parentId: string | null;
};
export type Tab = "apps" | "platform";
export type RoleSourceFilter = "all" | "local" | "dingtalk";
export type PermissionResource = {
  kind: "app" | "form";
  id: string;
  label: string;
};
export type PermissionState = "all" | "partial" | "none";
