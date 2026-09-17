"use client";

import { Display, Moon, Sun } from "@gravity-ui/icons";
import { Switch, Tabs } from "@heroui/react";
import {
  useTheme,
  type AppearanceSettings,
  type FontFamily,
  type RadiusSize,
  type SurfaceVariant,
  type ThemeMode,
  type ThemePreset,
} from "@shared/ThemeProvider";
import ColorPickerField from "@/app/components/my-fields/MyColorPicker";
import InfoTooltip from "@/app/components/InfoTooltip";
import OptionMenu, { type OptionMenuItem } from "@/app/components/OptionMenu";
import { SettingsContentCard } from "../components/SettingsContentCard";

const modeOptions: Array<{ id: ThemeMode; label: string; icon: typeof Sun }> = [
  { id: "light", label: "亮色", icon: Sun },
  { id: "dark", label: "暗色", icon: Moon },
  { id: "system", label: "跟随系统", icon: Display },
];
const accentSwatches = [
  "#0ea5e9",
  "#2563eb",
  "#7c3aed",
  "#a66cff",
  "#e11d48",
  "#10b981",
  "#f97316",
  "#ec4899",
];
const lightBaseSwatches = [
  "#ffffff",
  "#fafafa",
  "#f5f5f5",
  "#f4f4f5",
  "#f0f9ff",
  "#ecfdf5",
  "#fff1f2",
  "#fefce8",
];
const darkBaseSwatches = [
  "#09090b",
  "#18181b",
  "#1c1c1c",
  "#27272a",
  "#0f172a",
  "#102a22",
  "#2a0d18",
  "#1f2937",
];
const lightBackgroundSwatches = [
  "#dfe3ea",
  "#e4e4e7",
  "#dbeafe",
  "#d9f5e8",
  "#fce1e7",
  "#e5e7eb",
  "#dbe4f0",
  "#e8e5df",
];
const darkBackgroundSwatches = [
  "#18181b",
  "#202124",
  "#0b1628",
  "#10221c",
  "#24151a",
  "#1f2937",
  "#20252d",
  "#292524",
];
const foregroundSwatches = [
  "#000000",
  "#171717",
  "#262626",
  "#404040",
  "#737373",
  "#e5e5e5",
  "#f5f5f5",
  "#ffffff",
];
const radiusTokens: Record<RadiusSize, string> = {
  none: "0rem",
  small: "0.25rem",
  medium: "0.5rem",
  large: "0.75rem",
  xl: "1rem",
  "2xl": "1.5rem",
};
const radiusLabels: Record<RadiusSize, string> = {
  none: "无",
  small: "小",
  medium: "中",
  large: "大",
  xl: "超大",
  "2xl": "特大",
};
const radiusOptions: Array<OptionMenuItem<RadiusSize> & { symbol: string }> =
  Object.entries(radiusTokens).map(([id, value]) => ({
    id: id as RadiusSize,
    label: radiusLabels[id as RadiusSize],
    symbol:
      id === "none"
        ? "N"
        : id === "small"
          ? "S"
          : id === "medium"
            ? "M"
            : id === "large"
              ? "L"
              : id.toUpperCase(),
    surfaceStyle: { borderRadius: value },
    itemClassName: "border",
  }));
const surfaceOptions: OptionMenuItem<SurfaceVariant>[] = [
  { id: "secondary", label: "Secondary" },
  { id: "tertiary", label: "Tertiary" },
  { id: "transparent", label: "Transparent", itemClassName: "border" },
];
const fontOptions: OptionMenuItem<FontFamily>[] = [
  { id: "geist", label: "Geist" },
  { id: "inter", label: "Inter" },
  { id: "system", label: "系统字体" },
  { id: "serif", label: "衬线字体" },
];
const presetOptions: OptionMenuItem<ThemePreset>[] = [
  { id: "mengnex", label: "Mengnex" },
  { id: "heroui", label: "HeroUI 默认" },
  { id: "ocean", label: "Ocean 蓝" },
  { id: "emerald", label: "Emerald 绿" },
  { id: "rose", label: "Rose 玫红" },
  { id: "mono", label: "Mono 极简" },
  { id: "custom", label: "自定义" },
];

export default function ThemeSettingsPage() {
  const { theme, setTheme, appearance, setAppearance, setPreset } = useTheme();
  function update<Key extends keyof AppearanceSettings>(
    key: Key,
    value: AppearanceSettings[Key],
  ) {
    setAppearance({
      ...appearance,
      [key]: value,
      preset: key === "preset" ? (value as ThemePreset) : "custom",
    });
  }
  return (
    <section className="h-full min-h-0">
      <SettingsContentCard
        title="偏好设置"
        subtitle="调整界面模式与 HeroUI 组件的全局视觉样式。"
        headerActions={
          <Tabs
            aria-label="界面模式"
            selectedKey={theme}
            onSelectionChange={(key) => setTheme(key as ThemeMode)}
            className="w-96"
          >
            <Tabs.ListContainer className="w-full">
              <Tabs.List className="grid w-full grid-cols-3">
                {modeOptions.map(({ id, label, icon: Icon }) => (
                  <Tabs.Tab
                    key={id}
                    id={id}
                    className="justify-center whitespace-nowrap"
                  >
                    <Icon />
                    {label}
                    <Tabs.Indicator />
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs.ListContainer>
          </Tabs>
        }
      >
        <div>
          <div className="mb-4 flex items-center gap-2">
            <h3 className="font-semibold text-foreground">主题颜色</h3>
            <InfoTooltip content="全局背景负责渐变画布，基础色负责 Card 与内容 Surface；亮暗模式分别配置。" />
          </div>
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-xs font-medium text-muted">强调色</p>
              <div className="max-w-64">
                <ColorPickerField
                  label="强调色"
                  value={appearance.accent}
                  swatches={accentSwatches}
                  onChange={(value) => update("accent", value)}
                />
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-muted">亮色设置</p>
              <div className="space-x-8">
                <ColorPickerField
                  label="亮色全局背景"
                  value={appearance.backgroundLight}
                  swatches={lightBackgroundSwatches}
                  onChange={(value) => update("backgroundLight", value)}
                />
                <ColorPickerField
                  label="亮色基础色"
                  value={appearance.baseLight}
                  swatches={lightBaseSwatches}
                  onChange={(value) => update("baseLight", value)}
                />
                <ColorPickerField
                  label="亮色字体颜色"
                  value={appearance.foregroundLight}
                  swatches={foregroundSwatches}
                  onChange={(value) => update("foregroundLight", value)}
                />
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-muted">暗色设置</p>
              <div className="space-x-8">
                <ColorPickerField
                  label="暗色全局背景"
                  value={appearance.backgroundDark}
                  swatches={darkBackgroundSwatches}
                  onChange={(value) => update("backgroundDark", value)}
                />
                <ColorPickerField
                  label="暗色基础色"
                  value={appearance.baseDark}
                  swatches={darkBaseSwatches}
                  onChange={(value) => update("baseDark", value)}
                />
                <ColorPickerField
                  label="暗色字体颜色"
                  value={appearance.foregroundDark}
                  swatches={foregroundSwatches}
                  onChange={(value) => update("foregroundDark", value)}
                />
              </div>
            </div>
          </div>
        </div>
        <div className="mt-15">
          <div className="mb-4 flex items-center gap-2">
            <h3 className="font-semibold text-foreground">组件外观</h3>
            <InfoTooltip content="这些选项直接配置 HeroUI 的 Surface 与圆角 token。" />
          </div>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-5">
            <OptionMenu
              label="Surface"
              description="选择设置卡片使用的 HeroUI Surface 变体。"
              value={appearance.surfaceVariant}
              options={surfaceOptions}
              onChange={(value) => update("surfaceVariant", value)}
              className="w-full max-w-64"
            />
            <OptionMenu
              label="字体"
              value={appearance.fontFamily}
              options={fontOptions}
              onChange={(value) => update("fontFamily", value)}
              prefix={<span className="text-xs">Aa</span>}
            />
            <OptionMenu
              label="组件圆角"
              description="影响菜单、弹窗等界面组件。"
              value={appearance.radius}
              options={radiusOptions}
              onChange={(value) => update("radius", value)}
              prefix={
                <span className="font-semibold">
                  {
                    radiusOptions.find((item) => item.id === appearance.radius)
                      ?.symbol
                  }
                </span>
              }
              renderOption={(option) => (
                <>
                  <span className="text-xl font-semibold">
                    {
                      radiusOptions.find((item) => item.id === option.id)
                        ?.symbol
                    }
                  </span>
                  <span className="text-xs text-muted">{option.label}</span>
                </>
              )}
            />
            <OptionMenu
              label="表单圆角"
              description="影响输入框和选择框等表单元素。"
              value={appearance.radiusForm}
              options={radiusOptions}
              onChange={(value) => update("radiusForm", value)}
              prefix={
                <span className="font-semibold">
                  {
                    radiusOptions.find(
                      (item) => item.id === appearance.radiusForm,
                    )?.symbol
                  }
                </span>
              }
              renderOption={(option) => (
                <>
                  <span className="text-xl font-semibold">
                    {
                      radiusOptions.find((item) => item.id === option.id)
                        ?.symbol
                    }
                  </span>
                  <span className="text-xs text-muted">{option.label}</span>
                </>
              )}
            />
            <OptionMenu
              label="主题预设"
              value={appearance.preset}
              options={presetOptions}
              onChange={(value) => setPreset(value)}
            />
          </div>
        </div>
        <div className="mt-15">
          <div className="mb-4 flex items-center gap-2">
            <h3 className="font-semibold text-foreground">其他</h3>
            <InfoTooltip content="启用或禁用界面过渡动画。" />
          </div>
          <div className="flex items-start gap-3">
            <Switch
              aria-label="启用界面过渡动画"
              isSelected={appearance.animationsEnabled}
              onChange={(value) => update("animationsEnabled", value)}
            >
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch>
            <div>
              <p className="text-sm font-medium text-foreground">
                启用界面过渡动画
              </p>
              <p className="mt-1 text-xs text-muted">
                关闭后可减少低性能设备上的打开卡顿。
              </p>
            </div>
          </div>
        </div>
      </SettingsContentCard>
    </section>
  );
}
