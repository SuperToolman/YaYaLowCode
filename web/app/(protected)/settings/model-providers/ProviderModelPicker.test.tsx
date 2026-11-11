import React, { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { fetchModelRouteModels } from "@/features/settings/api";
import { notify } from "@/shared/lib/notify";
import { ProviderModelPicker } from "./ProviderModelPicker";

vi.mock("@/features/settings/api", () => ({ fetchModelRouteModels: vi.fn() }));
vi.mock("@/shared/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() }, notifyRequestError: vi.fn(),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const props = {
  id: "provider-1", apiBaseUrl: "https://api.siliconflow.cn/v1", apiKey: "",
  label: "模型", model: "", disabled: false, onChange: vi.fn(),
};

it("fetches models and replaces the configured model with the selected one", async () => {
  vi.mocked(fetchModelRouteModels).mockResolvedValue({ success: true, message: "ok", latencyMs: 5, models: ["model-a", "model-b"] });
  function ModelField() {
    const [model, setModel] = useState("model-a");
    return <ProviderModelPicker {...props} model={model} onChange={setModel} />;
  }
  render(<ModelField />);
  expect(screen.queryByRole("button", { name: "选择获取的模型" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "获取模型列表" }));
  fireEvent.click(await screen.findByRole("button", { name: "选择获取的模型" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "model-b" }));
  expect((screen.getByRole("textbox", { name: "模型" }) as HTMLInputElement).value).toBe("model-b");
  fireEvent.click(screen.getByRole("button", { name: "选择获取的模型" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "model-a" }));
  expect((screen.getByRole("textbox", { name: "模型" }) as HTMLInputElement).value).toBe("model-a");
  expect(fetchModelRouteModels).toHaveBeenCalledWith(props.id, { providerKind: "", apiBaseUrl: props.apiBaseUrl, apiKey: undefined });
});

it("uses global error notifications and leaves the input unchanged on failure", async () => {
  vi.mocked(fetchModelRouteModels).mockResolvedValue({ success: false, message: "鉴权失败", latencyMs: 5, models: [] });
  render(<ProviderModelPicker {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "获取模型列表" }));
  await waitFor(() => expect(notify.error).toHaveBeenCalledWith("获取模型列表失败", { description: "鉴权失败" }));
  expect(props.onChange).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "选择获取的模型" })).toBeNull();
});

it("discards models received after the connection configuration changes", async () => {
  let finish!: (result: Awaited<ReturnType<typeof fetchModelRouteModels>>) => void;
  vi.mocked(fetchModelRouteModels).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(<ProviderModelPicker {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "获取模型列表" }));
  view.rerender(<ProviderModelPicker {...props} apiKey="another-key" />);
  await act(async () => finish({ success: true, message: "ok", latencyMs: 5, models: ["old-model"] }));
  expect(screen.queryByRole("button", { name: "选择获取的模型" })).toBeNull();
  expect(notify.success).not.toHaveBeenCalled();
});
