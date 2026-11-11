import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ViewCustomButtonBindings } from "./ViewCustomButtonBindings";
import { getBindingOptions } from "@/features/custom-buttons/api";
import { emptyDraft, type ButtonDefinition } from "@/features/custom-buttons/model";

vi.mock("@/features/custom-buttons/api", () => ({ getBindingOptions: vi.fn(), removeButton: vi.fn(), saveButton: vi.fn() }));
vi.mock("./CustomButtonConfigModal", () => ({ CustomButtonConfigModal: () => null }));
vi.mock("@/shared/lib/notify", () => ({ notifyRequestError: vi.fn(), notify: { success: vi.fn() } }));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

it("reopening saved bindings resolves names and enables editing after options arrive", async () => {
  const button: ButtonDefinition = { ...emptyDraft(), id: "BTN-saved", appId: "app", formUuid: "form", name: "查看详情", createdAt: "", updatedAt: "" };
  const bindings = [{ buttonId: button.id }];
  for (let cycle = 0; cycle < 2; cycle++) {
    let resolve!: (items: ButtonDefinition[]) => void;
    vi.mocked(getBindingOptions).mockReturnValue(new Promise((done) => { resolve = done; }));
    const view = render(<ViewCustomButtonBindings appId="app" formUuid="form" bindings={bindings} onChange={() => {}} />);
    await act(async () => { resolve([button]); });
    expect(screen.getByText("查看详情")).toBeTruthy();
    expect(screen.queryByText(`失效按钮：${button.id}`)).toBeNull();
    expect((screen.getByRole("button", { name: "编辑按钮" }) as HTMLButtonElement).disabled).toBe(false);
    view.unmount();
  }
});
