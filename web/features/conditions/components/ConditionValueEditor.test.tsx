import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ConditionValueEditor } from "./ConditionValueEditor";
import { decodeConditionValue, encodeConditionValue } from "../value";

afterEach(cleanup);
const field = { key: "amount", label: "金额", fieldType: "number", options: [] };
it("数字条件使用可递增的 NumberField，输出数字值", () => {
  const change = vi.fn();
  render(<ConditionValueEditor field={field} operator="eq" value={encodeConditionValue(2)} onChange={change} />);
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "10" } });
  fireEvent.blur(input);
  expect(change).toHaveBeenCalled();
  expect(decodeConditionValue(change.mock.calls.at(-1)![0])).toBe(10);
});
it("区间输入分别编辑上下界", () => {
  const change = vi.fn();
  render(<ConditionValueEditor field={field} operator="between" value={encodeConditionValue([2, 10])} onChange={change} />);
  expect(screen.getAllByRole("textbox")).toHaveLength(2);
  expect(screen.getByLabelText("区间下界")).toBeTruthy();
  expect(screen.getByLabelText("区间上界")).toBeTruthy();
});
