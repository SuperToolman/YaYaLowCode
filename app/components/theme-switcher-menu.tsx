"use client";

import { Dropdown } from "@heroui/react";
import { ChevronDown, Display, Moon, Sun } from "@gravity-ui/icons";
import { type ThemeMode, useTheme } from "./theme-provider";

export default function ThemeSwitcherMenu() {
  const { resolvedTheme, setTheme, theme } = useTheme();
  const options: {
    icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    label: string;
    value: ThemeMode;
  }[] = [
    { icon: Sun, label: "亮色", value: "light" },
    { icon: Moon, label: "暗色", value: "dark" },
    { icon: Display, label: "跟随系统", value: "system" },
  ];
  const activeOption = options.find((option) => option.value === theme) ?? options[2];
  const ActiveIcon = activeOption.icon;
  const resolvedLabel = resolvedTheme === "dark" ? "暗色" : "亮色";

  return (
    <Dropdown>
      <Dropdown.Trigger>
        <div
          aria-label="切换主题"
          role="button"
          tabIndex={0}
          className="group flex min-h-[72px] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-transparent bg-transparent px-2 py-3 text-center text-[var(--text-secondary)] transition-all duration-200 backdrop-blur-xl hover:border-[var(--sidebar-soft-border)] hover:bg-[var(--sidebar-soft-bg)] hover:text-[var(--text-primary)]"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[rgba(255,255,255,0.08)] transition-colors group-hover:bg-[rgba(255,255,255,0.18)]">
            <ActiveIcon className="h-5 w-5" />
          </span>
          <span className="text-[11px] font-medium leading-4">
            {activeOption.label}
          </span>
          <span className="flex items-center gap-1 text-[10px] text-[var(--text-subtle)]">
            主题
            <ChevronDown className="h-3 w-3" />
          </span>
        </div>
      </Dropdown.Trigger>
      <Dropdown.Popover className="border border-[var(--panel-border)] bg-transparent shadow-none">
        <Dropdown.Menu
          aria-label="选择主题"
          className="min-w-[180px] rounded-2xl border border-[var(--panel-border)] bg-[var(--menu-background)] p-1.5 text-[var(--text-primary)] shadow-[0_20px_60px_rgba(0,0,0,0.18)] backdrop-blur-2xl"
          selectedKeys={[theme]}
          selectionMode="single"
          onAction={(key) => setTheme(key as ThemeMode)}
        >
          {options.map((option) => {
            const Icon = option.icon;

            return (
              <Dropdown.Item
                key={option.value}
                id={option.value}
                textValue={option.label}
                className="rounded-xl text-[var(--text-primary)] data-[hover=true]:bg-[var(--menu-item-hover)] data-[selected=true]:bg-[var(--menu-item-hover)]"
                description={
                  option.value === "system" ? `当前跟随${resolvedLabel}` : undefined
                }
                startContent={<Icon className="h-4 w-4" />}
              >
                {option.label}
              </Dropdown.Item>
            );
          })}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
