import { describe, expect, it } from "vitest";
import { toUpdateUserRequest, validateUserForm, type UserFormValues } from "./user-form";

const values: UserFormValues = { displayName: " Alice ", title: "", mobile: "", telephone: "", email: "", jobNumber: "", workPlace: "", remark: "", emailAddresses: [], roleIds: ["r1", "r1"] };
describe("user form", () => {
  it("validates name and normalizes roles", () => {
    expect(validateUserForm(values)).toBeNull();
    expect(toUpdateUserRequest(values)).toMatchObject({ displayName: "Alice", roleIds: ["r1"] });
  });
  it("rejects incomplete additional email", () => {
    expect(validateUserForm({ ...values, emailAddresses: [{ label: "", email: "a@b.com" }] })).toBeTruthy();
  });
});
