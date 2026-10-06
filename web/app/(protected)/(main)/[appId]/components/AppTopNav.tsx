"use client";

import { usePathname, useRouter } from "next/navigation";
import { Tabs } from "@heroui/react";

type AppTopNavProps = {
  appId: string;
};

export function AppTopNav({ appId }: AppTopNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  if (/\/automations\/[^/]+$/.test(pathname)) {
    return null;
  }

  const selectedKey = pathname.startsWith(`/${appId}/automations`)
    ? "automations"
    : pathname.startsWith(`/${appId}/settings`)
      ? "settings"
      : "overview";

  const hrefByKey = {
    overview: `/${appId}`,
    automations: `/${appId}/automations`,
    settings: `/${appId}/settings/basic`,
  } as const;

  return (
    <Tabs
      className="w-[360px]"
      selectedKey={selectedKey}
      onSelectionChange={(key) => router.push(hrefByKey[key as keyof typeof hrefByKey])}
    >
      <Tabs.ListContainer>
        <Tabs.List aria-label="应用功能导航">
          <Tabs.Tab id="overview">
            页面管理
            <Tabs.Indicator />
          </Tabs.Tab>
          <Tabs.Tab id="automations">
            集成&自动化
            <Tabs.Indicator />
          </Tabs.Tab>
          <Tabs.Tab id="settings">
            应用设置
            <Tabs.Indicator />
          </Tabs.Tab>
        </Tabs.List>
      </Tabs.ListContainer>
    </Tabs>
  );
}
