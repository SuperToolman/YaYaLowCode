import { expect, it, vi } from "vitest";
import { loadConditionSchema } from "../api";
import { resolveConditionChoices } from "./ConditionFieldSelect";
import { writeConditionPath } from "../value";

vi.mock("../api", () => ({ loadConditionSchema: vi.fn() }));
it("重载保存的 A → B → C 路径，使用终点字段类型和选项", async () => {
  vi.mocked(loadConditionSchema).mockResolvedValueOnce({ fields: [{ id: "group", label: "集团", type: "associationFormField", props: { associationFormId: "C" } }] } as never)
    .mockResolvedValueOnce({ fields: [{ id: "amount", label: "金额", type: "number", props: {} }] } as never);
  const roots = [{ key: "company", label: "公司", fieldType: "associationFormField", options: [], props: { associationFormId: "B" } }];
  const result = await resolveConditionChoices(roots, writeConditionPath({ root: "company", path: ["group", "amount"] }));
  expect(loadConditionSchema).toHaveBeenNthCalledWith(1, "B");
  expect(loadConditionSchema).toHaveBeenNthCalledWith(2, "C");
  expect(result.current?.fieldType).toBe("number");
  expect(result.current?.label).toBe("公司 / 集团 / 金额");
});
