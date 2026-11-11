"use client";

import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { Button, Dropdown } from "@heroui/react";
import { Plus } from "@gravity-ui/icons";
import type { DesignerDataSource } from "../designer-types";
import { DataSourceCard } from "./DataSourceCard";

export function DataSourcesPanel({ dataSources, onChange }: {
  dataSources: DesignerDataSource[];
  onChange: (sources: DesignerDataSource[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  function availableName(base: string) {
    const names = new Set(dataSources.map(source => source.name));
    let name = base;
    let index = 2;
    while (names.has(name)) name = `${base}_${index++}`;
    return name;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex flex-col items-stretch gap-2">
        <p className="text-xs leading-5 text-[var(--color-text-secondary)]">
          变量会注入到 <code>this.state.dataSources</code>
        </p>
        <div className="self-end">
          <Dropdown>
            <Button size="sm" variant="primary"><Plus />新建数据源</Button>
            <Dropdown.Popover>
              <Dropdown.Menu aria-label="新建数据源" onAction={key => {
                if (key !== "variable") return;
                onChange([...dataSources, {
                  id: `ds-${crypto.randomUUID()}`, name: availableName("newVar"),
                  kind: "string", initialValue: "", description: "",
                }]);
              }}>
                <Dropdown.Item id="variable">变量</Dropdown.Item>
                <Dropdown.Item id="api" isDisabled textValue="远程 API（暂未开放）">远程 API（暂未开放）</Dropdown.Item>
                <Dropdown.Item id="connector" isDisabled textValue="连接器（暂未开放）">连接器（暂未开放）</Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => {
        if (!over || active.id === over.id) return;
        const from = dataSources.findIndex(source => source.id === active.id);
        const to = dataSources.findIndex(source => source.id === over.id);
        if (from < 0 || to < 0) return;
        const reordered = [...dataSources];
        const [source] = reordered.splice(from, 1);
        reordered.splice(to, 0, source);
        onChange(reordered);
      }}>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-1">
          {dataSources.length === 0 ? <p className="py-8 text-center text-sm text-[var(--color-text-secondary)]">暂无数据源，点击上方按钮新建变量</p> : null}
          {dataSources.map(source => (
            <DataSourceCard key={source.id} source={source}
              names={dataSources.filter(item => item.id !== source.id).map(item => item.name)}
              onChange={updated => onChange(dataSources.map(item => item.id === source.id ? updated : item))}
              onCopy={() => {
                const copy = { ...source, id: `ds-${crypto.randomUUID()}`, name: availableName(`${source.name}_copy`) };
                const index = dataSources.findIndex(item => item.id === source.id);
                onChange([...dataSources.slice(0, index + 1), copy, ...dataSources.slice(index + 1)]);
              }}
              onDelete={() => onChange(dataSources.filter(item => item.id !== source.id))}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}
