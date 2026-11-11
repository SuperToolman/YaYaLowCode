import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ToggleSetting } from "./ToggleSetting";

afterEach(cleanup);

it("allows enabling and disabling a provider with the switch", () => {
  function ProviderToggle() {
    const [enabled, setEnabled] = useState(false);
    return (
      <ToggleSetting
        title="启用供应商"
        description="启用后，此供应商可用于模型调用。"
        selected={enabled}
        disabled={false}
        onChange={setEnabled}
      />
    );
  }

  render(<ProviderToggle />);
  const control = screen.getByRole("switch", { name: "启用供应商" });
  expect((control as HTMLInputElement).checked).toBe(false);
  fireEvent.click(control);
  expect((control as HTMLInputElement).checked).toBe(true);
  fireEvent.click(control);
  expect((control as HTMLInputElement).checked).toBe(false);
});

it("prevents changes while the setting is disabled", () => {
  const onChange = vi.fn();
  const { container } = render(
    <ToggleSetting
      title="启用供应商"
      description="启用后，此供应商可用于模型调用。"
      selected={false}
      disabled
      onChange={onChange}
    />,
  );
  const control = screen.getByRole("switch", { name: "启用供应商" });
  expect((control as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(container.querySelector('[data-slot="switch-control"]')!);
  expect((control as HTMLInputElement).checked).toBe(false);
  expect(onChange).not.toHaveBeenCalled();
});
