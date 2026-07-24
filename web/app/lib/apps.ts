export type AppStatus = "enabled" | "draft" | "paused";
export type AppColorTone = "primary" | "secondary" | "accent" | "success" | "warning";

export type AppItem = {
  id: string;
  name: string;
  desc: string;
  icon: string;
  badge?: string;
  color: AppColorTone;
  active?: boolean;
  status: AppStatus;
  createdAt: string;
  owner: string;
  ownerAvatarUrl?: string | null;
  records: number;
};

export type AppForm = {
  id: string;
  name: string;
  category: "menu" | "group";
  formType?: "normal" | "workflow" | "defined" | "detail";
  active?: boolean;
  count?: number;
};

export type FormColumn = {
  key: string;
  label: string;
  width?: string;
};

export type FormRow = Record<string, string>;

export type FormPageData = {
  formId: string;
  formName: string;
  title: string;
  columns: FormColumn[];
  rows: FormRow[];
  total: number;
};

export const quickActions = [
  { label: "创建应用", variant: "primary" as const, icon: "add" },
  { label: "应用迁移", variant: "secondary" as const, icon: "swap" },
  { label: "开始迁移", variant: "success" as const, icon: "download" },
  { label: "依赖修复", variant: "primary" as const, icon: "tool" },
];

export const apps: AppItem[] = [];

export const appStatusLabel: Record<AppStatus, string> = {
  enabled: "已启用",
  draft: "草稿中",
  paused: "已停用",
};

export const appStatusTone: Record<AppStatus, string> = {
  enabled: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
  draft: "bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
  paused: "bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]",
};

export const appColorToneClass: Record<AppColorTone, string> = {
  primary: "bg-[var(--color-primary-soft)] text-[var(--color-primary)]",
  secondary: "bg-[var(--color-secondary-soft)] text-[var(--color-secondary)]",
  accent: "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
  success: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
  warning: "bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
};

export function normalizeAppColorTone(value: string | null | undefined): AppColorTone {
  if (
    value === "primary" ||
    value === "secondary" ||
    value === "accent" ||
    value === "success" ||
    value === "warning"
  ) {
    return value;
  }

  const legacyValue = value?.toLowerCase() ?? "";
  if (legacyValue.includes("green") || legacyValue.includes("emerald")) return "success";
  if (legacyValue.includes("amber") || legacyValue.includes("yellow")) return "warning";
  if (legacyValue.includes("pink") || legacyValue.includes("rose")) return "accent";
  if (legacyValue.includes("teal") || legacyValue.includes("cyan")) return "secondary";
  return "primary";
}

export const formsByAppId: Record<string, AppForm[]> = {

};

export const appRouteAliases: Record<
  string,
  {
    appId: string;
    defaultFormUuid: string;
  }
> = {
  APP_LGIR6ASVTV6S1KEJGS9N: {
    appId: "rd-center",
    defaultFormUuid: "FORM-2078B4AA330F429BA6B6C850B0841DCAX3P3",
  },
};

export const formPageDataById: Record<string, FormPageData> = {
  overview: {
    formId: "overview",
    formName: "项目基础信息",
    title: "项目基础信息",
    total: 8,
    columns: [
      { key: "name", label: "项目名称", width: "180px" },
      { key: "code", label: "项目编码", width: "120px" },
      { key: "owner", label: "项目负责人", width: "120px" },
      { key: "dept", label: "所属部门", width: "220px" },
      { key: "period", label: "项目周期", width: "220px" },
      { key: "type", label: "项目类型", width: "90px" },
      { key: "level", label: "项目级别", width: "90px" },
      { key: "stage", label: "当前阶段", width: "120px" },
      { key: "status", label: "当前状态", width: "100px" },
    ],
    rows: [
      {
        name: "测试项目 XXX",
        code: "TEST-001",
        owner: "小兰同学",
        dept: "无锡福佳半导体科技有限公司",
        period: "2026-06-05 ~ 2026-06-14",
        type: "研发",
        level: "一般",
        stage: "项目立项",
        status: "完成",
      },
      {
        name: "六寸二代升级",
        code: "RD-002",
        owner: "何佑欣",
        dept: "研发部",
        period: "2026-04-01 ~ 2026-07-01",
        type: "研发",
        level: "重点",
        stage: "项目立项",
        status: "进行中",
      },
      {
        name: "AFGV-C200",
        code: "RD-003",
        owner: "蒋刘云",
        dept: "研发部",
        period: "2026-06-01 ~ 2026-07-31",
        type: "研发",
        level: "重点",
        stage: "需求评审",
        status: "待开启",
      },
      {
        name: "测试项目",
        code: "GY-004",
        owner: "小兰同学",
        dept: "工艺工程部",
        period: "2026-06-04 ~ 2026-06-21",
        type: "工艺",
        level: "重点",
        stage: "项目立项",
        status: "进行中",
      },
      {
        name: "BOM 结构优化",
        code: "RD-005",
        owner: "沈工",
        dept: "产品研发部",
        period: "2026-06-08 ~ 2026-08-10",
        type: "研发",
        level: "一般",
        stage: "方案设计",
        status: "进行中",
      },
      {
        name: "封装工艺验证",
        code: "GY-006",
        owner: "陈晓峰",
        dept: "工艺工程部",
        period: "2026-05-15 ~ 2026-07-18",
        type: "工艺",
        level: "重点",
        stage: "样品试制",
        status: "进行中",
      },
      {
        name: "MES 接口建设",
        code: "IT-007",
        owner: "周文博",
        dept: "信息化部",
        period: "2026-06-12 ~ 2026-09-01",
        type: "信息化",
        level: "一般",
        stage: "方案评审",
        status: "待开启",
      },
      {
        name: "供应链协同平台",
        code: "SC-008",
        owner: "杜工",
        dept: "供应链管理部",
        period: "2026-03-01 ~ 2026-08-30",
        type: "供应链",
        level: "重点",
        stage: "上线准备",
        status: "完成",
      },
    ],
  },
  stock: {
    formId: "stock",
    formName: "库存台账",
    title: "库存台账",
    total: 8,
    columns: [
      { key: "sku", label: "物料编码", width: "120px" },
      { key: "name", label: "物料名称", width: "180px" },
      { key: "warehouse", label: "仓库", width: "140px" },
      { key: "qty", label: "库存数量", width: "110px" },
      { key: "safe", label: "安全库存", width: "110px" },
      { key: "unit", label: "单位", width: "90px" },
      { key: "keeper", label: "仓管员", width: "120px" },
      { key: "status", label: "库存状态", width: "110px" },
    ],
    rows: [
      {
        sku: "MAT-001",
        name: "导轨组件",
        warehouse: "主仓库",
        qty: "3520",
        safe: "1000",
        unit: "套",
        keeper: "刘仓管",
        status: "充足",
      },
      {
        sku: "MAT-020",
        name: "连接器 B",
        warehouse: "电子仓",
        qty: "620",
        safe: "800",
        unit: "个",
        keeper: "王雪",
        status: "预警",
      },
      {
        sku: "MAT-118",
        name: "外壳件",
        warehouse: "成品仓",
        qty: "1206",
        safe: "500",
        unit: "件",
        keeper: "刘仓管",
        status: "充足",
      },
      {
        sku: "MAT-301",
        name: "包装箱",
        warehouse: "辅料仓",
        qty: "200",
        safe: "300",
        unit: "个",
        keeper: "周晓静",
        status: "不足",
      },
      {
        sku: "MAT-402",
        name: "散热片",
        warehouse: "主仓库",
        qty: "980",
        safe: "700",
        unit: "片",
        keeper: "刘仓管",
        status: "充足",
      },
      {
        sku: "MAT-563",
        name: "标签纸",
        warehouse: "辅料仓",
        qty: "150",
        safe: "200",
        unit: "卷",
        keeper: "周晓静",
        status: "不足",
      },
      {
        sku: "MAT-771",
        name: "测试板卡",
        warehouse: "电子仓",
        qty: "66",
        safe: "100",
        unit: "块",
        keeper: "王雪",
        status: "预警",
      },
      {
        sku: "MAT-888",
        name: "成品包装袋",
        warehouse: "成品仓",
        qty: "960",
        safe: "500",
        unit: "包",
        keeper: "陈嘉怡",
        status: "充足",
      },
    ],
  },
};

export function isRuntimeAppId(appId: string) {
  return /^APP_[A-Z0-9]+$/.test(appId);
}

export function getAppByRouteId(routeAppId: string): AppItem | undefined {
  const directApp = apps.find((item) => item.id === routeAppId);

  if (directApp) {
    return directApp;
  }

  if (isRuntimeAppId(routeAppId)) {
    return createRuntimeApp(routeAppId);
  }

  const alias = appRouteAliases[routeAppId];

  if (!alias) {
    return undefined;
  }

  return apps.find((item) => item.id === alias.appId);
}

export function getFormsByRouteAppId(routeAppId: string) {
  if (isRuntimeAppId(routeAppId)) {
    return [];
  }

  const alias = isRuntimeAppId(routeAppId)
    ? undefined
    : appRouteAliases[routeAppId];
  const resolvedAppId = alias?.appId ?? routeAppId;

  return formsByAppId[resolvedAppId] ?? formsByAppId["rd-center"] ?? [];
}

function createRuntimeApp(appId: string): AppItem {
  return {
    id: appId,
    name: `应用 ${appId.slice(0, 12)}`,
    desc: "运行时应用",
    icon: "general",
    color: "primary",
    status: "enabled",
    createdAt: "2026-06-09",
    owner: "系统",
    records: 0,
  };
}
