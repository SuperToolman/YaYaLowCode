import Link from "next/link";
import {
  Bell,
  CircleQuestion,
  Gear,
  House,
  LayoutHeaderCellsLarge,
  Magnifier,
} from "@gravity-ui/icons";
import { Button, Input } from "@heroui/react";
import { LogoIcon } from "../../components/app-icons";

type PlatformHeaderProps = {
  active: "home" | "apps";
};

const navItems = [
  { key: "home", label: "工作台", href: "/", icon: House },
  {
    key: "apps",
    label: "我的应用",
    href: "/myApp",
    icon: LayoutHeaderCellsLarge,
  },
];

export function PlatformHeader({ active }: PlatformHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-[#dfe7f3] bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#2f6bff] text-white shadow-[0_10px_24px_rgba(47,107,255,0.2)]">
            <LogoIcon />
          </span>
          <span className="hidden min-w-0 sm:block">
            <span className="block truncate text-base font-semibold text-[#14213d]">
              丫丫 LowCode
            </span>
            <span className="block truncate text-xs text-[#7587a3]">
              数字化应用工作台
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.key === active;

            return (
              <Link
                key={item.key}
                href={item.href}
                className={[
                  "flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-[#edf4ff] text-[#2f6bff]"
                    : "text-[#4f6484] hover:bg-[#f6f9fe] hover:text-[#14213d]",
                ].join(" ")}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto hidden h-9 max-w-[360px] flex-1 items-center gap-2 rounded-lg border border-[#dfe7f3] bg-[#f7faff] px-3 lg:flex">
          <Magnifier className="h-4 w-4 shrink-0 text-[#7587a3]" />
          <Input
            className="flex-1"
            placeholder="搜索应用、表单、流程"
          />
        </div>

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <IconButton label="帮助">
            <CircleQuestion className="h-4 w-4" />
          </IconButton>
          <IconButton label="消息">
            <Bell className="h-4 w-4" />
          </IconButton>
          <IconButton label="设置">
            <Gear className="h-4 w-4" />
          </IconButton>
          <Button
            type="button"
            aria-label="当前用户"
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#17324f] text-sm font-semibold text-white"
          >
            Y
          </Button>
        </div>
      </div>
    </header>
  );
}

function IconButton({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <Button
      aria-label={label}
      variant="ghost"
      className="flex h-9 w-9 min-w-9 items-center justify-center rounded-lg border border-[#dfe7f3] bg-white p-0 text-[#4f6484]"
    >
      {children}
    </Button>
  );
}
