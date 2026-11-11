import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { PropertyNumberField, PropertySelectField, PropertySegmented, PropertySwitch } from "./PropertyControls";

afterEach(cleanup);
beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterAll(() => vi.unstubAllGlobals());

it("下拉框支持选择业务值，再清空为显式空选项", async () => {
  function Harness() {
    const [value, setValue] = useState("member");
    return (
      <>
        <PropertySelectField
          ariaLabel="字段"
          value={value}
          onChange={setValue}
          options={[
            { value: "", label: "未选择" },
            { value: "member", label: "成员" },
          ]}
        />
        <output data-testid="value">{value}</output>
      </>
    );
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: /字段/ }));
  fireEvent.click(await screen.findByRole("option", { name: "未选择" }));
  expect(screen.getByTestId("value").textContent).toBe("");
  fireEvent.click(screen.getByRole("button", { name: /字段/ }));
  expect(
    (await screen.findByRole("option", { name: "未选择" })).getAttribute(
      "aria-selected",
    ),
  ).toBe("true");
  fireEvent.click(screen.getByRole("option", { name: "成员" }));
  expect(screen.getByTestId("value").textContent).toBe("member");
});

it("数值清空传递 undefined，失焦时遵循上下限", () => {
  const change = vi.fn();
  function Harness() {
    const [value, setValue] = useState<number | undefined>(2);
    return (
      <PropertyNumberField
        value={value}
        min={1}
        max={5}
        onChange={(next) => {
          setValue(next);
          change(next);
        }}
      />
    );
  }
  render(<Harness />);
  const input = screen.getByRole("textbox", { name: "数值属性" });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.blur(input);
  expect(change).toHaveBeenLastCalledWith(undefined);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "99" } });
  fireEvent.blur(input);
  expect(change).toHaveBeenLastCalledWith(5);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "0" } });
  fireEvent.blur(input);
  expect(change).toHaveBeenLastCalledWith(1);
});

it("开关和分段选择向业务层传递新值", () => {
  const toggle = vi.fn();
  const select = vi.fn();
  render(
    <>
      <PropertySwitch
        aria-label="允许多选"
        isSelected={false}
        onChange={toggle}
      />
      <PropertySegmented
        value="left"
        options={[
          { value: "left", label: "左" },
          { value: "right", label: "右" },
        ]}
        onChange={select}
      />
    </>,
  );
  fireEvent.click(screen.getByRole("switch", { name: "允许多选" }));
  expect(toggle).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByRole("tab", { name: "右" }));
  expect(select).toHaveBeenCalledWith("right");
});
