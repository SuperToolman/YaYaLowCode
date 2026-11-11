import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CustomButtonParameters } from "./CustomButtonParameters";
import type { ButtonParameter } from "@/features/custom-buttons/model";
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const fields = [{ key: "code", label: "客户代码", fieldType: "singleLineText", options: [] }];
function Editor({ initial, onSave }: { initial: ButtonParameter[]; onSave: (rows: ButtonParameter[]) => void }) {
  const [rows, setRows] = useState(initial);
  return <><CustomButtonParameters parameters={rows} fields={fields} disabled={false} onChange={setRows} /><button onClick={() => onSave(rows)}>保存</button></>;
}
it("真实 HeroUI 表格支持新增、编辑、删除并重新加载保存的参数", async () => {
  const save = vi.fn();
  const view = render(<Editor initial={[]} onSave={save} />);
  fireEvent.click(screen.getByRole("button", { name: /新增自定义参数/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "参数名称" }), { target: { value: "customerCode" } });
  fireEvent.change(screen.getByRole("textbox", { name: "参数值" }), { target: { value: "客户001" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  const saved = save.mock.calls[0][0];
  expect(saved[0]).toEqual(expect.objectContaining({ name: "customerCode", type: "constant", value: "客户001" }));
  expect(saved[0].id).toBeTruthy();
  view.unmount();
  render(<Editor initial={saved} onSave={save} />);
  expect((screen.getByRole("textbox", { name: "参数名称" }) as HTMLInputElement).value).toBe("customerCode");
  expect((screen.getByRole("textbox", { name: "参数值" }) as HTMLInputElement).value).toBe("客户001");
  fireEvent.click(screen.getByRole("button", { name: "删除" }));
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "参数名称" })).toBeNull());
});
it("字段选项加载后更新真实 HeroUI 集合的显示名称", async () => {
  const rows: ButtonParameter[] = [{ id: "p", name: "customerCode", type: "field", fieldId: "code" }];
  const change = vi.fn();
  const view = render(<CustomButtonParameters parameters={rows} fields={[]} disabled={false} onChange={change} />);
  view.rerender(<CustomButtonParameters parameters={rows} fields={fields} disabled={false} onChange={change} />);
  await waitFor(() => expect(screen.getByRole("button", { name: /参数来源字段/ }).textContent).toContain("客户代码"));
});
