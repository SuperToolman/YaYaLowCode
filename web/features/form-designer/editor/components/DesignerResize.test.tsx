import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DesignerScreen } from "./DesignerScreen";
import * as layout from "../designer-layout";
import * as schemaModule from "../designer-schema";
import type { PlacedField } from "../designer-types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/features/auth/components/AuthProvider", () => ({ useAuth: () => ({ hasPermission: () => true, permissionsReady: true }) }));
vi.mock("@/features/form-designer", async (original) => ({
  ...await original<typeof import("@/features/form-designer")>(),
  getDesignerForm: async () => ({ name: "测试", formType: "normal" }),
  getDesignerSchema: async () => ({ version: 1, latestVersion: 1, schema: { formName: "测试", fields: [
    { id: "a", type: "singleLineText", label: "a", row: 0, column: 0, rowSpan: 1, colSpan: 1, props: {}, parentGroupId: null },
  ] } }),
  listDesignerVersions: async () => [],
}));
vi.mock("./DesignerWorkbenchSidebar", () => ({ DesignerWorkbenchSidebar: ({ schema }: { schema: { fields: PlacedField[] } }) =>
  <output data-testid="schema-span">{schema.fields[0]?.colSpan}</output>,
}));
vi.mock("./DesignerCanvas", () => ({ DesignerCanvas: (props: React.ComponentProps<typeof import("./DesignerCanvas").DesignerCanvas>) =>
  <div ref={props.gridRef}>
    <output data-testid="canvas-span">{props.fields[0]?.colSpan}</output>
    <button aria-label="resize"
      onPointerDown={(event) => { event.currentTarget.setPointerCapture = () => undefined; props.onResizePointerDown(event, props.fields[0], "columns"); }}
      onPointerMove={props.onResizePointerMove} onPointerUp={props.onResizePointerUp} onPointerCancel={props.onResizePointerCancel} />
  </div>,
}));
vi.mock("./field-properties/FieldPropertyDrawer", () => ({ FieldPropertyPanel: () => null }));
vi.mock("./page-properties/PagePropertyDrawer", () => ({ PagePropertyPanel: () => null }));
vi.mock("./FormDesignerHeader", () => ({ FormDesignerHeader: () => null }));
vi.mock("./FormPreviewModal", () => ({ FormPreviewModal: () => null }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function setup() {
  vi.stubGlobal("PointerEvent", class extends MouseEvent { pointerId = 1; });
  let frame: FrameRequestCallback | undefined;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => { frame = undefined; });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 600, height: 68, left: 0, top: 0, right: 600, bottom: 68, x: 0, y: 0, toJSON: () => ({}) });
  const resize = vi.spyOn(layout, "resizeField"), build = vi.spyOn(schemaModule, "buildSchema");
  render(<DesignerScreen appId={null} formUuid="test" />);
  await waitFor(() => expect(screen.getByTestId("canvas-span").textContent).toBe("1"));
  resize.mockClear(); build.mockClear();
  const button = screen.getByRole("button", { name: "resize" });
  return { button, resize, build, flush: () => act(() => { const next = frame; frame = undefined; next?.(0); }) };
}

it("同一跨度不重复排布，预览不生成 Schema，结束只提交一次", async () => {
  const { button, resize, build, flush } = await setup();
  fireEvent.pointerDown(button, { clientX: 0 });
  fireEvent.pointerMove(button, { clientX: 110 }); flush();
  expect(screen.getByTestId("canvas-span").textContent).toBe("2");
  expect(screen.getByTestId("schema-span").textContent).toBe("1");
  expect(build).not.toHaveBeenCalled();
  fireEvent.pointerMove(button, { clientX: 111 }); flush();
  expect(resize).toHaveBeenCalledTimes(1);
  fireEvent.pointerUp(button);
  expect(screen.getByTestId("schema-span").textContent).toBe("2");
  expect(build).toHaveBeenCalledTimes(1);
});

it.each(["pointercancel", "escape"])("%s 取消缩放恢复画布且不提交 Schema", async (kind) => {
  const { button, build, flush } = await setup();
  fireEvent.pointerDown(button, { clientX: 0 });
  fireEvent.pointerMove(button, { clientX: 110 }); flush();
  if (kind === "pointercancel") fireEvent.pointerCancel(button); else fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.getByTestId("canvas-span").textContent).toBe("1");
  expect(screen.getByTestId("schema-span").textContent).toBe("1");
  expect(build).not.toHaveBeenCalled();
});

it("缩放历史提交后第一次撤销即恢复，重做不被重复快照清空", async () => {
  const { button, flush } = await setup();
  fireEvent.pointerDown(button, { clientX: 0 });
  fireEvent.pointerMove(button, { clientX: 110 }); flush();
  fireEvent.pointerUp(button);
  // Allow the normal history debounce to commit before the shortcut flushes it again.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
  fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  expect(screen.getByTestId("schema-span").textContent).toBe("1");
  fireEvent.keyDown(window, { key: "y", ctrlKey: true });
  expect(screen.getByTestId("schema-span").textContent).toBe("2");
  fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  expect(screen.getByTestId("schema-span").textContent).toBe("1");
});
