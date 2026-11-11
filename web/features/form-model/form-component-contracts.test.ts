import { describe, expect, it } from "vitest";
import { FORM_COMPONENT_CONTRACT_VERSION, getComponentCatalog, getComponentManifest, validateComponentField } from "./form-component-contracts";
import { getFormComponentAgentCapability } from "./form-component-agent-capabilities";

describe("form component contracts", () => {
  it("registers advanced components and exposes recipes", () => {
    expect(FORM_COMPONENT_CONTRACT_VERSION).toBe(1);
    expect(getComponentCatalog().map((item) => item.type)).toEqual(expect.arrayContaining([
      "associationFormField",
      "subform",
      "cascader",
      "member",
      "department",
      "serialNumber",
    ]));
    expect(getComponentManifest("subform")?.agent.recipes[0].intent).toContain("明细表");
  });

  it("projects manifest capabilities without breaking value-fill behavior", () => {
    const select = getFormComponentAgentCapability("select");
    expect(select.writable).toBe(true);
    expect(select.capabilities).toEqual(expect.arrayContaining(["create", "configure", "writeValue"]));
    expect(getFormComponentAgentCapability("unknown-component").writable).toBe(false);
  });

  it("returns field-level validation issues", () => {
    const issues = validateComponentField({ type: "select", props: { options: [{ label: "重复", value: "same" }, { label: "再次重复", value: "same" }] } });
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "/props/options/1/value", code: "duplicate" }),
    ]));
  });

});
