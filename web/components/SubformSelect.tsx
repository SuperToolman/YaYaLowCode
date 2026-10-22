"use client";
import { useEffect, useState } from "react";
import { Button, ListBox, Select } from "@heroui/react";
import { getFormSchema } from "@/app/lib/http";
import { useAuth } from "@/app/components/AuthProvider";
import { MyShip } from "@/components/ui/MyShip";

export function SubformSelect({ parentFormId, value, onChange }: { parentFormId: string; value: string; onChange: (value: string) => void }) {
  const { permissionsReady, hasPermission } = useAuth();
  const [result, setResult] = useState<{ parent: string; items: { id: string; label: string }[]; error: boolean } | null>(null);
  const [retry, setRetry] = useState(0);
  const canRead = permissionsReady && hasPermission(`form:${parentFormId}:display`);
  useEffect(() => {
    if (!parentFormId || !canRead) return;
    let cancelled = false;
    void getFormSchema({ path: { formUuid: parentFormId }, responseStyle: "fields" }).then(({ data, error }) => {
      if (!cancelled) setResult({ parent: parentFormId, items: ((data?.data?.schema as { fields?: { id: string; label: string; type: string }[] } | undefined)?.fields ?? []).filter((field) => field.type === "subform"), error: Boolean(error || data?.code !== 0) });
    }).catch(() => { if (!cancelled) setResult({ parent: parentFormId, items: [], error: true }); });
    return () => { cancelled = true; };
  }, [parentFormId, canRead, retry]);
  if (!parentFormId) return <p role="status">请先选择来源数据节点</p>;
  if (!permissionsReady) return <p role="status">正在加载权限…</p>;
  if (!canRead) return <p role="status">暂无权限查看该表单的子表</p>;
  if (result?.parent !== parentFormId) return <p role="status">正在加载子表…</p>;
  if (result.error) return <div role="alert">子表加载失败<Button size="sm" onPress={() => setRetry((count) => count + 1)}>重试</Button></div>;
  const items = result.items;
  if (!result.items.length) return <MyShip color="warning" content="该表单不存在子表单，请先在表单设计器中配置子表单" />;
  return <Select aria-label="目标子表" selectedKey={items.some((item) => item.id === value) ? value : null} onSelectionChange={(key) => onChange(String(key ?? ""))}>
    <Select.Trigger><Select.Value>{items.find((item) => item.id === value)?.label ?? "选择子表"}</Select.Value><Select.Indicator /></Select.Trigger>
    <Select.Popover><ListBox>{items.map((item) => <ListBox.Item key={item.id} id={item.id} textValue={item.label}>{item.label}</ListBox.Item>)}</ListBox></Select.Popover>
  </Select>;
}
