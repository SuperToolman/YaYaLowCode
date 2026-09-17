import { describe, expect, it } from "vitest";
import { filterUsers, normalizeUser, type UserItem } from "./user-list";

const user = { id: "1", displayName: "Alice", username: null, email: null, mobile: "138", title: "工程师", jobNumber: null, telephone: null, workPlace: null, remark: null, avatarUrl: null, roleIds: [], departments: ["研发"], roles: ["成员"], status: "active", sourceType: "local" } as unknown as UserItem;
describe("identity user list model", () => {
  it("normalizes nullable fields", () => expect(normalizeUser(user)).toMatchObject({ displayName: "Alice", roleIds: [] }));
  it("filters by business fields", () => expect(filterUsers([user], "研发", "all", "all")).toHaveLength(1));
});
