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
      <Dropdown.Trigger
        aria-label={`切换主题，当前${activeOption.label}`}
        className="group flex h-[68px] w-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-transparent bg-transparent px-2 text-center text-[var(--color-text-secondary)] transition-all duration-200 backdrop-blur-xl hover:border-[var(--sidebar-soft-border)] hover:bg-[var(--sidebar-soft-bg)] hover:text-[var(--color-text-primary)]"
      >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-control-soft)] transition-colors group-hover:bg-[var(--color-control-soft-hover)]">
            <ActiveIcon className="h-5 w-5" />
          </span>
          <span className="text-[11px] font-medium leading-4">主题</span>
      </Dropdown.Trigger>
      <Dropdown.Popover className="border border-[var(--color-border)] bg-transparent shadow-none">
        <Dropdown.Menu
          aria-label="选择主题"
          className="min-w-[180px] rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-menu)] p-1.5 text-[var(--color-text-primary)] shadow-[var(--shadow-floating)] backdrop-blur-2xl"
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
                className="rounded-xl text-[var(--color-text-primary)] data-[hover=true]:bg-[var(--color-bg-hover)] data-[selected=true]:bg-[var(--color-bg-hover)]"
              >
                <span className="flex items-center gap-2">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex min-w-0 flex-col">
                    <span>{option.label}</span>
                    {option.value === "system" ? (
                      <span className="text-xs text-[var(--color-text-secondary)]">
                        当前跟随{resolvedLabel}
                      </span>
                    ) : null}
                  </span>
                </span>
              </Dropdown.Item>
            );
          })}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

export function CompactThemeSwitcher() {
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

  return (
    <Dropdown>
      <Dropdown.Trigger
        aria-label={`切换主题，当前${activeOption.label}`}
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-input)] px-3 text-sm font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
      >
          <ActiveIcon className="h-4 w-4" />
          <span>{activeOption.label}</span>
          <ChevronDown className="h-3 w-3" />
      </Dropdown.Trigger>
      <Dropdown.Popover className="border border-[var(--color-border)] bg-transparent shadow-none">
        <Dropdown.Menu
          aria-label="选择主题"
          className="min-w-[170px] rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-menu)] p-1.5 text-[var(--color-text-primary)] shadow-[var(--shadow-floating)] backdrop-blur-2xl"
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
                className="rounded-lg text-[var(--color-text-primary)] data-[hover=true]:bg-[var(--color-bg-hover)] data-[selected=true]:bg-[var(--color-bg-hover)]"
              >
                <span className="flex items-center gap-2">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex min-w-0 flex-col">
                    <span>{option.label}</span>
                    {option.value === "system" ? (
                      <span className="text-xs text-[var(--color-text-secondary)]">
                        当前跟随{resolvedTheme === "dark" ? "暗色" : "亮色"}
                      </span>
                    ) : null}
                  </span>
                </span>
              </Dropdown.Item>
            );
          })}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
