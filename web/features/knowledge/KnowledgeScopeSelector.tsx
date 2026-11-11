"use client";
import { useQuery } from "@tanstack/react-query";
import { BookOpen } from "@gravity-ui/icons";
import { Button, Checkbox, Popover, Spinner } from "@heroui/react";
import { useAuth } from "@/features/auth/components/AuthProvider";
import { listBases } from "./client";

export function KnowledgeScopeSelector({ selected, onChange, disabled }: {
  selected: string[]; onChange: (ids: string[]) => void; disabled: boolean;
}) {
  const { user, permissionsReady } = useAuth();
  const query = useQuery({
    queryKey: ["knowledge", user?.id, "application", "agent-scope"],
    queryFn: ({ signal }) => listBases("application", undefined, signal),
    enabled: permissionsReady,
  });
  return <Popover>
    <Button isIconOnly variant="ghost" aria-label={`知识范围，已选 ${selected.length} 个应用知识库`} isDisabled={disabled}><BookOpen /></Button>
    <Popover.Content className="flex max-h-80 max-w-sm flex-col gap-3 overflow-y-auto">
      <Popover.Heading>知识范围</Popover.Heading>
      <p className="text-xs text-muted">默认包含平台全局资料及当前员工知识，可添加应用知识库。</p>
      {query.isPending ? <Spinner aria-label="加载知识范围" /> : query.isError ? <Button size="sm" variant="ghost" onPress={() => void query.refetch()}>重新加载</Button> : query.data.items.length ? query.data.items.map((base) => (
        <Checkbox key={base.id} isSelected={selected.includes(base.id)} isDisabled={disabled || (!selected.includes(base.id) && selected.length >= 50)} onChange={(checked) => onChange(checked ? [...selected, base.id] : selected.filter((id) => id !== base.id))}>
          <Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control><span>{base.name}</span></Checkbox.Content>
        </Checkbox>
      )) : <p className="text-xs text-muted">暂无可添加的应用知识库。</p>}
    </Popover.Content>
  </Popover>;
}
