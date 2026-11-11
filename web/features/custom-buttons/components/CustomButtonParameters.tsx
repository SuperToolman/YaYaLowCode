"use client";
import { Button, Input, InputGroup, Label, ListBox, Select, Table, TextField } from "@heroui/react";
import type { SourceFieldChoice } from "@/features/conditions";
import type { ButtonParameter } from "@/features/custom-buttons/model";

export function CustomButtonParameters({ parameters, fields, disabled, onChange }: {
  parameters: ButtonParameter[];
  fields: SourceFieldChoice[];
  disabled: boolean;
  onChange: (parameters: ButtonParameter[]) => void;
}) {
  function update(id: string, patch: Partial<ButtonParameter>) {
    onChange(parameters.map(row => row.id === id ? { ...row, ...patch } : row));
  }
  return <section className="space-y-3" aria-label="页面参数配置">
    <Label>参数列表</Label>
    <Table><Table.ScrollContainer><Table.Content aria-label="页面参数列表">
      <Table.Header>
        <Table.Column id="name" isRowHeader>参数名称</Table.Column>
        <Table.Column id="type">参数类型</Table.Column>
        <Table.Column id="value">参数值</Table.Column>
        <Table.Column id="actions">操作</Table.Column>
      </Table.Header>
      <Table.Body renderEmptyState={() => <p className="p-4 text-center text-muted">暂无参数</p>}>
        <Table.Collection items={parameters} dependencies={[fields, disabled, onChange]}>{row => <Table.Row id={row.id}>
          <Table.Cell><TextField aria-label="参数名称" value={row.name} isDisabled={disabled} onChange={name => update(row.id, { name })}><InputGroup><InputGroup.Input maxLength={20} placeholder="请输入" /><InputGroup.Suffix><span className="text-xs text-muted">{[...row.name].length}/20</span></InputGroup.Suffix></InputGroup></TextField></Table.Cell>
          <Table.Cell><Select aria-label="参数类型" selectedKey={row.type} isDisabled={disabled} onSelectionChange={type => update(row.id, { type: type === "field" ? "field" : "constant" })}>
            <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
            <Select.Popover><ListBox><ListBox.Item id="constant">常量</ListBox.Item><ListBox.Item id="field">当前记录字段</ListBox.Item></ListBox></Select.Popover>
          </Select></Table.Cell>
          <Table.Cell>{row.type === "constant" ? <TextField aria-label="参数值" value={row.value ?? ""} isDisabled={disabled} onChange={value => update(row.id, { value })}><Input placeholder="请输入" /></TextField> : <Select aria-label="参数来源字段" selectedKey={row.fieldId ?? null} isDisabled={disabled} onSelectionChange={key => update(row.id, { fieldId: String(key ?? "") })}>
            <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
            <Select.Popover><ListBox items={fields}>{field => <ListBox.Item id={field.key} textValue={field.label}>{field.label}</ListBox.Item>}</ListBox></Select.Popover>
          </Select>}</Table.Cell>
          <Table.Cell><Button variant="tertiary" isDisabled={disabled} onPress={() => onChange(parameters.filter(item => item.id !== row.id))}>删除</Button></Table.Cell>
        </Table.Row>}</Table.Collection>
      </Table.Body>
    </Table.Content></Table.ScrollContainer></Table>
    <Button variant="tertiary" isDisabled={disabled} onPress={() => onChange([...parameters, { id: crypto.randomUUID(), name: "", type: "constant", value: "" }])}>＋ 新增自定义参数</Button>
  </section>;
}
