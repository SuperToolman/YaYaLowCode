import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeFormRenderer } from "./RuntimeFormRenderer";
import type { RuntimeFieldProps, RuntimeFormSchema } from "../../form-model/runtime-types";

const auth = vi.hoisted(() => ({ user: { id: "logged-in" } as { id: string } | null }));
vi.mock("@/features/auth/components/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("./RuntimeMemberSelect", () => ({
  RuntimeMemberSelect: ({ value, onChange }: { value: string | string[]; onChange: (value: string | string[]) => void }) =>
    <><output data-testid="member">{JSON.stringify(value)}</output><button type="button" onClick={() => onChange(Array.isArray(value) ? [] : "")}>清空成员</button></>,
}));

afterEach(cleanup);
beforeEach(() => { auth.user = { id: "logged-in" }; });

function setup(props: RuntimeFieldProps, extra: Partial<React.ComponentProps<typeof RuntimeFormRenderer>> = {}) {
  const schema: RuntimeFormSchema = { formUuid: "form", columns: 1, rows: 1, fields: [
    { id: "member", type: "member", label: "成员", row: 0, column: 0, props },
  ] };
  const onValuesChange = vi.fn();
  const onSubmit = vi.fn();
  const rendererProps = { schema, submitLabel: "提交", onSubmit, onValuesChange, ...extra };
  return { ...render(<RuntimeFormRenderer {...rendererProps} />), rendererProps, onValuesChange, onSubmit };
}

describe("成员默认值的运行时填充", () => {
  it("新增表单立即填入当前登录人，并包含在提交值中", async () => {
    const { onSubmit } = setup({ defaultValueType: "currentUser" });
    expect(screen.getByTestId("member").textContent).toBe('"logged-in"');
    fireEvent.click(screen.getByRole("button", { name: "提交" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ member: "logged-in" }));
  });
  it("多选当前登录人使用成员 ID 数组", () => {
    setup({ defaultValueType: "currentUser", memberMultiple: true });
    expect(screen.getByTestId("member").textContent).toBe('["logged-in"]');
  });
  it("自定义默认成员直接填入，单选仅保留一个", () => {
    setup({ defaultValueType: "custom", defaultValue: ["chosen", "other"] });
    expect(screen.getByTestId("member").textContent).toBe('"chosen"');
  });
  it("多选自定义默认成员保留所有指定成员", () => {
    setup({ defaultValueType: "custom", memberMultiple: true, defaultValue: ["chosen", "other"] });
    expect(screen.getByTestId("member").textContent).toBe('["chosen","other"]');
  });
  it("无默认值时不读取残留自定义值", () => {
    setup({ defaultValueType: "none", defaultValue: "old" });
    expect(screen.getByTestId("member").textContent).toBe('""');
  });
  it("已有记录的空值不会被默认值覆盖", () => {
    setup({ defaultValueType: "currentUser" }, { recordUuid: "existing", initialValues: { member: "" } });
    expect(screen.getByTestId("member").textContent).toBe('""');
  });
  it("传入的成员值优先于当前登录人", () => {
    setup({ defaultValueType: "currentUser" }, { initialValues: { member: "saved" } });
    expect(screen.getByTestId("member").textContent).toBe('"saved"');
  });
  it("用户清空后不重复填充", () => {
    const { rerender, rendererProps } = setup({ defaultValueType: "currentUser" });
    fireEvent.click(screen.getByRole("button", { name: "清空成员" }));
    rerender(<RuntimeFormRenderer {...rendererProps} />);
    expect(screen.getByTestId("member").textContent).toBe('""');
  });
  it("登录信息稍后加载时补齐默认值，清空后保持为空", async () => {
    auth.user = null;
    const { rerender, rendererProps } = setup({ defaultValueType: "currentUser" });
    expect(screen.getByTestId("member").textContent).toBe('""');
    auth.user = { id: "late-user" };
    rerender(<RuntimeFormRenderer {...rendererProps} />);
    await waitFor(() => expect(screen.getByTestId("member").textContent).toBe('"late-user"'));
    fireEvent.click(screen.getByRole("button", { name: "清空成员" }));
    rerender(<RuntimeFormRenderer {...rendererProps} />);
    expect(screen.getByTestId("member").textContent).toBe('""');
  });
});
