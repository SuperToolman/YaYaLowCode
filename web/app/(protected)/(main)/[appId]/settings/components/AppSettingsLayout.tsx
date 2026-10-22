"use client";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { RouterProvider } from "react-aria-components";
import { Card, Label, ListBox } from "@heroui/react";
import { Gear } from "@gravity-ui/icons";

export function AppSettingsLayout({ appId, appName, selectedKey, children }: { appId: string; appName?: string; selectedKey: "basic"; children: ReactNode }) {
  const router = useRouter();
  return <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-4 lg:grid-cols-[240px_minmax(0,1fr)] lg:grid-rows-1">
    <aside className="min-h-0"><Card className="h-full min-h-0"><Card.Header><Card.Description>应用配置</Card.Description><Card.Title className="truncate">{appName || "应用设置"}</Card.Title></Card.Header><Card.Content className="min-h-0 overflow-y-auto">
      <RouterProvider navigate={(href) => router.push(href)}>
      <nav aria-label="应用设置导航"><ListBox aria-label="应用设置" selectionMode="single" selectedKeys={[selectedKey]} disallowEmptySelection>
        <ListBox.Item id="basic" textValue="基础设置" href={`/${appId}/settings/basic`} aria-current={selectedKey === "basic" ? "page" : undefined}><Gear width={16} height={16} /><Label>基础设置</Label><ListBox.ItemIndicator /></ListBox.Item>
      </ListBox></nav>
      </RouterProvider>
    </Card.Content></Card></aside>{children}
  </div>;
}
