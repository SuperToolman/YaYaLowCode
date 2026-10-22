import { Pencil, Plus, Check, Play, File, Gear, Thunderbolt, ArrowRight } from "@gravity-ui/icons";
export const BUTTON_ICONS = [
  { id: "pencil", label: "编辑", Component: Pencil }, { id: "plus", label: "新增", Component: Plus },
  { id: "check", label: "确认", Component: Check }, { id: "play", label: "执行", Component: Play },
  { id: "file", label: "表单", Component: File }, { id: "gear", label: "设置", Component: Gear },
  { id: "bolt", label: "自动化", Component: Thunderbolt }, { id: "arrow-right", label: "下一步", Component: ArrowRight },
];
export function CustomButtonIcon({icon}: {icon?: string | null}) { const item = BUTTON_ICONS.find((i)=>i.id===icon);return item ? <item.Component width={16} height={16} /> : null; }
