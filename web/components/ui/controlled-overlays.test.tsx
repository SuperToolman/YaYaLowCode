import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AlertDialog, Modal } from "@heroui/react";
import { FormDataImportDrawer, type ImportWorkbookState } from "@/app/(protected)/(main)/[appId]/[formUuid]/components/FormDataImportDrawer";

vi.mock("@shared/ThemeProvider", () => ({
  useTheme: () => ({ appearance: { surfaceVariant: "default" } }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("opens and closes the import drawer without press responder warnings", () => {
  const warn = vi.spyOn(console, "warn");
  const onOpenChange = vi.fn();
  const state: ImportWorkbookState = {
    fileName: "", headers: [], rows: [], mappings: {}, progress: 0,
    successCount: 0, failureCount: 0, importing: false, completed: false,
  };
  const props = {
    isOpen: false, onOpenChange, state, setState: vi.fn(), fields: [],
    builtinFieldLabels: new Set<string>(), onDownloadTemplate: vi.fn(),
    onFileChange: vi.fn(), onSheetChange: vi.fn(), onImport: vi.fn(),
  };
  const view = render(<FormDataImportDrawer {...props} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(warn).not.toHaveBeenCalled();

  view.rerender(<FormDataImportDrawer {...props} isOpen />);
  expect(screen.getByRole("dialog", { name: "导入表单数据" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "关闭导入" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);

  view.rerender(<FormDataImportDrawer {...props} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(warn).not.toHaveBeenCalled();
});

it.each([
  { Overlay: Modal, role: "dialog" },
  { Overlay: AlertDialog, role: "alertdialog" },
])("controls a $role without a trigger or press responder warnings", ({ Overlay, role }) => {
  const warn = vi.spyOn(console, "warn");
  const onOpenChange = vi.fn();
  const overlay = (isOpen: boolean) => (
    <Overlay.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Overlay.Container>
        <Overlay.Dialog>
          <Overlay.Heading>确认操作</Overlay.Heading>
          <Overlay.CloseTrigger aria-label="关闭" />
        </Overlay.Dialog>
      </Overlay.Container>
    </Overlay.Backdrop>
  );
  const view = render(overlay(false));
  expect(screen.queryByRole(role)).toBeNull();
  expect(warn).not.toHaveBeenCalled();

  view.rerender(overlay(true));
  expect(screen.getByRole(role, { name: "确认操作" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);

  view.rerender(overlay(false));
  expect(screen.queryByRole(role)).toBeNull();
  expect(warn).not.toHaveBeenCalled();
});
