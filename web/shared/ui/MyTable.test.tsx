import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getChangedColumnWidths, getSafeColumnWidth, MyTable } from "./MyTable";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

type Item = { id: string; name: string; children?: Item[] };

it.each([undefined, NaN, Infinity, -Infinity, 0, -1])("阻止无效列宽进入布局：%s", (width) => {
  expect(getSafeColumnWidth(width, 80)).toBe(80);
});

it("保留正常动态宽度", () => {
  expect(getSafeColumnWidth(52, 80)).toBe(52);
});

it("列宽和最小宽度为 NaN 时仍能渲染表格", () => {
  render(<MyTable ariaLabel="异常列宽" data={[{ id: "1", name: "正常渲染" }]} columns={[{ id: "name", header: "名称", accessorKey: "name", size: NaN, minSize: NaN }]} getRowId={(row) => row.id} />);
  expect(screen.getByText("正常渲染")).toBeTruthy();
});

it("只返回本次拖拽中实际变化的列宽", () => {
  expect(
    getChangedColumnWidths(
      { selection: 44, name: 180, status: 120, actions: 180 },
      { selection: 44, name: 240, status: 120, actions: 180 },
    ),
  ).toEqual({ name: 240 });
});

it("使用 HeroUI 展开与收起子行，并随数据更新显示子表内容", async () => {
  const props = {
    ariaLabel: "主子表", getRowId: (row: Item) => row.id,
    getSubRows: (row: Item) => row.children, treeColumn: "name",
    columns: [{ id: "name", header: "明细.名称", accessorKey: "name", enableSorting: false }],
  };
  const data: Item[] = [{ id: "parent", name: "主记录", children: [{ id: "child-1", name: "子表第一行" }, { id: "child-2", name: "子表第二行" }] }];
  const { rerender } = render(<MyTable {...props} data={data} />);
  expect(screen.getByText("明细.名称")).toBeTruthy();
  expect(screen.queryByText("子表第一行")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /展开子表数据/ }));
  await waitFor(() => expect(screen.getByText("子表第一行")).toBeTruthy());
  expect(screen.getByText("子表第二行")).toBeTruthy();
  rerender(<MyTable {...props} data={[{ ...data[0], children: [{ id: "child-1", name: "更新后的子表" }] }]} />);
  await waitFor(() => expect(screen.getByText("更新后的子表")).toBeTruthy());
  expect(screen.queryByText("子表第二行")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /收起子表数据/ }));
  await waitFor(() => expect(screen.queryByText("更新后的子表")).toBeNull());
});

it("无子表的普通表格正常显示且没有展开按钮", () => {
  render(<MyTable ariaLabel="普通表格" data={[{ id: "1", name: "普通记录" }]} columns={[{ id: "name", header: "名称", accessorKey: "name" }]} getRowId={(row) => row.id} />);
  expect(screen.getByText("普通记录")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "展开子表数据" })).toBeNull();
});

it("无子行时显示禁用的展开控件", () => {
  render(<MyTable ariaLabel="空子表" data={[{ id: "1", name: "空明细", children: [] }]} columns={[{ id: "name", header: "名称", accessorKey: "name" }]} getRowId={(row) => row.id} getSubRows={(row) => row.children} treeColumn="name" isExpandableRow={() => true} />);
  expect(screen.getByRole("button", { name: /展开子表数据/ }).hasAttribute("disabled")).toBe(true);
});

it("允许由子表摘要单元格提供独立展开按钮", () => {
  render(<MyTable<Item> ariaLabel="独立子表" data={[{ id: "1", name: "记录", children: [{ id: "2", name: "明细" }] }]} columns={[{ id: "name", header: "名称", accessorKey: "name" }]} getRowId={(row) => row.id} getSubRows={(row) => row.children} treeColumn="name" showTreeExpander={false} isExpandableRow={() => true} />);
  expect(screen.getByText("记录")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /展开子表数据/ })).toBeNull();
});
