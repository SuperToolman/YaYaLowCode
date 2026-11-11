import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FormSeparator, separatorOrientationOptions, separatorStyleOptions, separatorVariantOptions } from "./FormSeparator";
import { RuntimeFieldNode, RuntimeFormRenderer } from "./RuntimeFormRenderer";
import type { RuntimeFormSchema, RuntimeSchemaField } from "../../form-model/runtime-types";
import { isRuntimeDataField, isRuntimeContainerField } from "../field-registry";
import { validateRuntimeFields } from "./runtime-form-validation";
import { getExcelImportFields } from "@/features/records/model/excel-import";
import { getFormComponentAgentCapability } from "@/features/form-model/form-component-agent-capabilities";

vi.mock("@/features/auth/components/AuthProvider", () => ({ useAuth: () => ({ user: { id: "viewer" }, token: "session", permissions: [] }) }));
afterEach(cleanup);

const separator: RuntimeSchemaField = {
  id: "separator", type: "separator", label: "内容分割线", row: 0, column: 0, rowSpan: 1, colSpan: 6,
  props: { separatorStyle: "dashed", separatorVariant: "secondary", description: "下一部分" },
};
const schema: RuntimeFormSchema = { formUuid: "separator-test", columns: 6, rows: 2, fields: [separator] };

describe("FormSeparator", () => {
  it("stretches the horizontal wrapper to center the line within its grid cell", () => {
    render(<FormSeparator label="分割线" />);
    const line = screen.getByRole("separator");
    expect(line.parentElement?.classList.contains("self-stretch")).toBe(true);
    expect(line.parentElement?.classList.contains("justify-center")).toBe(true);
    expect(line.parentElement?.classList.contains("min-h-6")).toBe(true);
    expect(line.style.flexShrink).toBe("0");
  });

  it.each(separatorStyleOptions)("renders the $value line style using HeroUI", ({ value }) => {
    render(<FormSeparator label="分割线" separatorStyle={value} />);
    const line = screen.getByRole("separator", { name: "分割线" });
    expect(line.getAttribute("data-slot")).toBe("separator");
    expect(line.parentElement?.getAttribute("data-separator-style")).toBe(value);
    expect(line.style.height).toBe("1px");
    if (value === "dashed") expect(line.style.backgroundImage).toContain("10px, transparent 10px 16px");
    if (value === "dotted") {
      expect(line.style.backgroundImage).toContain("radial-gradient");
      expect(line.style.backgroundSize).toBe("8px 1px");
    }
  });

  it.each(separatorOrientationOptions)("renders all styles in $value orientation with visible vertical height", ({ value }) => {
    const { rerender } = render(<FormSeparator label="分割线" orientation={value} />);
    for (const { value: style } of separatorStyleOptions) {
      rerender(<FormSeparator label="分割线" orientation={value} separatorStyle={style} />);
      const line = screen.getByRole("separator");
      expect(line.getAttribute("data-orientation")).toBe(value);
      if (value === "vertical") {
        expect(line.getAttribute("aria-orientation")).toBe("vertical");
        expect(line.style.minHeight).toBe("48px");
        expect(line.style.width).toBe("1px");
      }
      if (style === "dashed") expect(line.style.backgroundImage).toContain(value === "vertical" ? "to bottom" : "to right");
      if (style === "dotted") expect(line.style.backgroundSize).toBe(value === "vertical" ? "1px 8px" : "8px 1px");
      expect(line.style.backgroundRepeat).toBe(style === "solid" ? "" : value === "vertical" ? "repeat-y" : "repeat-x");
    }
  });

  it.each(separatorVariantOptions)("passes the $value variant to HeroUI", ({ value }) => {
    render(<FormSeparator label="分割线" separatorVariant={value} />);
    expect(screen.getByRole("separator").classList.contains(`separator--${value}`)).toBe(true);
  });

  it.each(["designer", "runtime"] as const)("uses the shared separator in %s mode", (mode) => {
    const onFieldAction = vi.fn();
    render(<RuntimeFieldNode field={separator} mode={mode} childFieldsByParent={new Map()} value={undefined} values={{}} onFieldAction={onFieldAction} />);
    expect(screen.getByRole("separator", { name: separator.label }).style.backgroundImage).toContain("repeating-linear-gradient");
    expect(screen.getByText("下一部分")).toBeTruthy();
    expect(onFieldAction).not.toHaveBeenCalled();
  });

  it.each([false, true])("preserves vertical rendering and updates patterns across runtime/read-only (%s)", (readOnlyDisplay) => {
    const verticalSchema = { ...schema, fields: [{ ...separator, props: { ...separator.props, orientation: "vertical" as const } }] };
    const props = { schema: verticalSchema, readOnlyDisplay, submitLabel: "提交", onSubmit: vi.fn() };
    const { rerender } = render(<RuntimeFormRenderer {...props} />);
    expect(screen.getByRole("separator").getAttribute("aria-orientation")).toBe("vertical");
    rerender(<RuntimeFormRenderer {...props} schema={{ ...schema, fields: [{ ...separator, props: { separatorStyle: "dotted" } }] }} />);
    const line = screen.getByRole("separator");
    expect(line.getAttribute("data-orientation")).toBe("horizontal");
    expect(line.style.backgroundSize).toBe("8px 1px");
    expect(line.style.minHeight).toBe("");
  });

  it("keeps the separator in static read-only output without initializing scripts or values", () => {
    const onValuesChange = vi.fn();
    render(<RuntimeFormRenderer schema={{ ...schema, pageProps: { actionPanel: { code: "throw new Error('must not execute')" } } }} readOnlyDisplay onValuesChange={onValuesChange} submitLabel="提交" onSubmit={vi.fn()} />);
    expect(screen.getByRole("separator", { name: separator.label })).toBeTruthy();
    expect(screen.getByText("下一部分")).toBeTruthy();
    expect(onValuesChange).not.toHaveBeenCalled();
  });

  it("does not submit a separator value or block validation, and respects hidden state", async () => {
    const onSubmit = vi.fn();
    const props = { schema, submitLabel: "提交", onSubmit };
    const { rerender } = render(<RuntimeFormRenderer {...props} initialValues={{ separator: "legacy value" }} />);
    fireEvent.click(screen.getByRole("button", { name: "提交" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({}));
    rerender(<RuntimeFormRenderer {...props} schema={{ ...schema, fields: [{ ...separator, props: { isHidden: true } }] }} />);
    expect(screen.queryByRole("separator")).toBeNull();
    rerender(<RuntimeFormRenderer {...props} readOnlyDisplay schema={{ ...schema, fields: [{ ...separator, props: { isHidden: true } }] }} />);
    expect(screen.queryByRole("separator")).toBeNull();
    expect(validateRuntimeFields([{ ...separator, props: { isRequired: true } }], {})).toEqual({});
  });

  it("remains a non-data, non-container node across import and Agent capabilities", () => {
    expect(isRuntimeDataField(separator)).toBe(false);
    expect(isRuntimeContainerField(separator)).toBe(false);
    expect(getExcelImportFields([separator])).toEqual([]);
    const capability = getFormComponentAgentCapability("separator");
    expect(capability.writable).toBe(false);
    expect(capability.capabilities).toEqual(["create", "configure"]);
  });
});
