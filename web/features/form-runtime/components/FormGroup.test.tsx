import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { FormGroup, groupTitleTypeOptions } from "./FormGroup";

afterEach(cleanup);

it("未设置标题变体的历史分组使用 H4，并保留描述和子组件", () => {
  render(<FormGroup title="基本信息" description="请填写"><input aria-label="姓名" /></FormGroup>);
  expect(screen.getByRole("heading", { name: "基本信息", level: 4 })).toBeTruthy();
  expect(screen.getByText("请填写")).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "姓名" })).toBeTruthy();
});

it.each(groupTitleTypeOptions)("支持 Typography 标题变体 $value", ({ value }) => {
  render(<FormGroup title="基本信息" groupTitleType={value} />);
  const title = screen.getByText("基本信息");
  expect(title.classList.contains(`typography--${value}`)).toBe(true);
  if (/^h[1-6]$/.test(value)) {
    expect(screen.getByRole("heading", { name: "基本信息", level: Number(value[1]) })).toBe(title);
  }
});
