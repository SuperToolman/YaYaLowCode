"use client";

import { usePathname } from "next/navigation";

export function AppSectionSubtitle({ appId }: { appId: string }) {
  const pathname = usePathname();

  if (pathname.startsWith(`/${appId}/automations`)) {
    return <>集成&自动化</>;
  }

  if (pathname.startsWith(`/${appId}/settings`)) {
    return <>应用设置</>;
  }

  return <>应用工作台</>;
}
