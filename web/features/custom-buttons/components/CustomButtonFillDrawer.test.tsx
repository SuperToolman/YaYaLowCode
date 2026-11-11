import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CustomButtonFillDrawer } from "./CustomButtonFillDrawer";
import { emptyDraft, type ButtonDefinition } from "@/features/custom-buttons/model";
import { resolveButtonFill, submitButton } from "@/features/custom-buttons/api";
import { fetchCurrentFormSchema } from "@/features/form-runtime/api";
const mocks = vi.hoisted(() => ({ renderForm: vi.fn(), error: vi.fn() }));
vi.mock("@heroui/react", () => {
  const Part = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { Drawer: Object.assign(Part, { Backdrop: Part, Content: Part, Dialog: Part, Header: Part, Heading: Part, CloseTrigger: () => null, Body: Part }), Button: ({ children, onPress, isDisabled }: { children: React.ReactNode; onPress: () => void; isDisabled?: boolean }) => <button disabled={isDisabled} onClick={onPress}>{children}</button> };
});
vi.mock("@/features/custom-buttons/api", () => ({ resolveButtonFill: vi.fn(), submitButton: vi.fn() }));
vi.mock("@/features/form-runtime/api", () => ({ fetchCurrentFormSchema: vi.fn() }));
vi.mock("@/shared/lib/notify", () => ({ notify: { success: vi.fn() }, notifyRequestError: mocks.error }));
vi.mock("@/features/form-runtime/components/RuntimeFormRenderer", () => ({ RuntimeFormRenderer: (props: { onSubmit: (values: Record<string, unknown>) => void }) => { mocks.renderForm(props); return <button onClick={() => props.onSubmit({ text: "修改", hidden: "不能提交", other: "其他值" })}>保存表单</button>; } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const targetRecord = { id: "target-record", formUuid: "target", data: { text: "已有值" }, createdBy: "用户", updatedBy: "用户", createdAt: "2026-10-26", updatedAt: "2026-10-26", schemaVersion: 1 };
function result(operation: string) { return { operation, targetRecord: operation === "update" ? targetRecord : null, candidates: operation === "select" ? [targetRecord] : [], total: operation === "select" ? 22 : operation === "update" ? 1 : 0, page: 1, pageSize: 20, initialValues: { text: operation === "update" ? "已有值" : "默认值" }, configurationVersion: "version" }; }
function setup(same = false) {
  const button: ButtonDefinition = { ...emptyDraft(), id: "button", name: "填写", formUuid: "source", appId: "app", createdAt: "", updatedAt: "", actionConfig: { targetAppId: "app", targetFormUuid: same ? "source" : "target", fieldIds: same ? ["text"] : [], associationRules: [] } };
  vi.mocked(fetchCurrentFormSchema).mockResolvedValue({ formUuid: button.actionConfig.targetFormUuid, columns: 6, rows: 10, fields: [{ id: "text", label: "文本", type: "singleLineText", row: 0, column: 0 }, { id: "other", label: "其他", type: "singleLineText", row: 1, column: 0 }, { id: "hidden", label: "隐藏", type: "singleLineText", row: 2, column: 0, props: { isHidden: true } }] });
  const onClose = vi.fn(), onSaved = vi.fn();
  render(<CustomButtonFillDrawer button={button} sourceFormUuid="source" viewUuid="view" recordId="source-record" onClose={onClose} onSaved={onSaved} />);
  return { onClose, onSaved };
}
it("同表加载当前记录、只展示所选字段、提交后刷新", async () => {
  vi.mocked(resolveButtonFill).mockResolvedValue(result("update"));
  const { onClose, onSaved } = setup(true);
  fireEvent.click(await screen.findByText("保存表单"));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(onClose).toHaveBeenCalled();
  expect(mocks.renderForm.mock.lastCall?.[0].schema.fields.map((f: { id: string }) => f.id)).toEqual(["text"]);
  expect(submitButton).toHaveBeenCalledWith("source", "view", "button", expect.objectContaining({ operation: "update", targetRecordId: "target-record", data: { text: "修改" }, configurationVersion: "version" }));
});
it("跨表无匹配带入默认值并保留全表可编辑字段", async () => {
  vi.mocked(resolveButtonFill).mockResolvedValue(result("create"));
  setup();
  fireEvent.click(await screen.findByText("保存表单"));
  await waitFor(() => expect(submitButton).toHaveBeenCalled());
  expect(mocks.renderForm.mock.lastCall?.[0].initialValues).toEqual({ text: "默认值" });
  expect(submitButton).toHaveBeenCalledWith("source", "view", "button", expect.objectContaining({ operation: "create", data: { text: "修改", other: "其他值" } }));
});
it("多匹配先分页选择，再解析并编辑选中实例", async () => {
  vi.mocked(resolveButtonFill).mockResolvedValueOnce(result("select")).mockResolvedValueOnce({ ...result("select"), page: 2 }).mockResolvedValueOnce(result("update"));
  setup();
  fireEvent.click(await screen.findByText("下一页"));
  await waitFor(() => expect(resolveButtonFill).toHaveBeenCalledWith("source", "view", "button", "source-record", 2, undefined));
  fireEvent.click(await screen.findByRole("button", { name: /target-record/ }));
  await screen.findByText("保存表单");
  expect(resolveButtonFill).toHaveBeenLastCalledWith("source", "view", "button", "source-record", 1, "target-record");
});
it("失败可重试，网络重试沿用同一个幂等请求标识", async () => {
  vi.mocked(resolveButtonFill).mockResolvedValue(result("create"));
  vi.mocked(submitButton).mockRejectedValue(new Error("网络失败"));
  setup();
  fireEvent.click(await screen.findByText("保存表单"));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByText("保存表单"));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(2));
  expect(vi.mocked(submitButton).mock.calls[0][3].requestId).toBe(vi.mocked(submitButton).mock.calls[1][3].requestId);
});
