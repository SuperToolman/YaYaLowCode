import { describe, expect, it } from "vitest";
import type { IdentityUser } from "@/features/form-runtime/types";
import type { RuntimeSchemaField } from "@/features/form-model/runtime-types";
import type { FormRecord } from "@/features/records/types";
import { estimateTableColumnWidth, getTableFieldDisplayValue } from "@/features/records/screen/form-record-utils";

const user: IdentityUser = {
  id: "00000000-0000-4000-8000-000000000001", displayName: "张三",
  jobNumber: "A001", avatarUrl: null, roles: [], sourceType: "local", status: "active",
};
const users = new Map([[user.id, user]]);
const field = (props = {}): RuntimeSchemaField => ({
  id: "sales", type: "member", label: "业务员", row: 0, column: 0, props,
});
const record = (value: unknown): FormRecord => ({
  id: "record", formUuid: "form", schemaVersion: 1,
  createdAt: "2026-10-23T00:00:00Z", updatedAt: "2026-10-23T00:00:00Z",
  createdBy: "创建人", updatedBy: "创建人", data: { sales: value },
});
const display = (value: unknown, props = {}) => getTableFieldDisplayValue(field(props), record(value), new Map(), users);

describe("表格列宽估算", () => {
  it("空值和占位符不应扩展标题宽度", () => {
    expect(estimateTableColumnWidth(["", "   ", "-"])).toBe(12);
  });
  it("按最宽实际内容估算并计入单元格留白和字段装饰", () => {
    expect(estimateTableColumnWidth(["短", "较长内容"], 24, 320, 30)).toBe(90);
  });
  it("保留最大列宽上限", () => {
    expect(estimateTableColumnWidth(["超长".repeat(100)], 24, 320)).toBe(320);
  });
});

describe("成员表格显示", () => {
  it("将存储的用户 ID 转换为真实姓名且保留原始记录", () => {
    const saved = record(user.id);
    expect(getTableFieldDisplayValue(field(), saved, new Map(), users)).toBe("张三");
    expect(saved.data.sales).toBe(user.id);
  });
  it("支持多选成员及未匹配成员的回退", () => {
    expect(display([user.id, "missing-user"])).toBe("张三、missing-user");
    expect(getTableFieldDisplayValue(field(), record(user.id), new Map())).toBe(user.id);
  });
  it("遵循成员显示格式", () => {
    expect(display(user.id, { memberDisplayFormat: "nameJobNumber" })).toBe("张三(A001)");
    expect(display(user.id, { memberDisplayFormat: "nameUserId" })).toBe(`张三(${user.id})`);
  });
  it.each([undefined, null, "", [], [""]])("空成员显示占位符：%j", (value) => {
    expect(display(value)).toBe("-");
  });
  it("普通文本字段保持原值", () => {
    expect(getTableFieldDisplayValue({ ...field(), type: "singleLineText" }, record(user.id), new Map(), users)).toBe(user.id);
  });
});
