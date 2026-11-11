import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RuntimeCheckboxOptions } from "./RuntimeFormFieldControls";

afterEach(cleanup);

const options = [
  { label: "选项一", value: "first" },
  { label: "选项二", value: "second" },
];

it("preserves other selections when checking and unchecking an option", () => {
  function Field() {
    const [value, setValue] = useState(["first"]);
    return <RuntimeCheckboxOptions ariaLabel="复选框" options={options}
      value={value} onChange={setValue} isDisabled={false} />;
  }
  render(<Field />);
  const first = screen.getByRole("checkbox", { name: "选项一" }) as HTMLInputElement;
  const second = screen.getByRole("checkbox", { name: "选项二" }) as HTMLInputElement;
  expect(first.checked).toBe(true);
  fireEvent.click(second);
  expect(first.checked).toBe(true);
  expect(second.checked).toBe(true);
  fireEvent.click(first);
  expect(first.checked).toBe(false);
  expect(second.checked).toBe(true);
});

it("keeps disabled designer and read-only selections unchanged", () => {
  const onChange = vi.fn();
  render(<RuntimeCheckboxOptions ariaLabel="复选框" options={options}
    value={["first"]} onChange={onChange} isDisabled />);
  fireEvent.click(screen.getByRole("checkbox", { name: "选项二" }));
  expect(onChange).not.toHaveBeenCalled();
});

it("exposes required and invalid group states", () => {
  render(<RuntimeCheckboxOptions ariaLabel="复选框" options={options}
    value={[]} onChange={vi.fn()} isDisabled={false} isRequired isInvalid />);
  const group = screen.getByRole("group", { name: "复选框" });
  expect(group.getAttribute("data-required")).toBe("true");
  expect(group.getAttribute("data-invalid")).toBe("true");
});
