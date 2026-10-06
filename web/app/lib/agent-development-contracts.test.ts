import { describe, expect, it } from "vitest";
import {
  AGENT_DEVELOPMENT_CONTRACT_VERSION,
  applyPatch,
  getAutomationCatalog,
  getComponentCatalog,
  getComponentManifest,
  validateAutomationNode,
  validateComponentField,
} from "./agent-development-contracts";
import { getFormComponentAgentCapability } from "./form-component-agent-capabilities";

describe("agent development contracts", () => {
  it("registers advanced components and exposes recipes", () => {
    expect(AGENT_DEVELOPMENT_CONTRACT_VERSION).toBe(1);
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

  it("validates automation references", () => {
    const issues = validateAutomationNode("update-data", { targetFormUuid: "missing", rows: [], sourceNodeId: "node-2" }, {
      formIds: ["form-1"],
      upstreamNodeIds: ["node-1"],
    });
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "/targetFormUuid", code: "not_found" }),
      expect.objectContaining({ path: "/sourceNodeId", code: "not_upstream" }),
    ]));
    expect(getAutomationCatalog().map((item) => item.kind)).toEqual(expect.arrayContaining(["add-data", "update-data", "condition", "http-request"]));
  });

  it("applies structured patches without mutating the source", () => {
    const source = { props: { subformArrangement: "tile" } };
    const next = applyPatch(source, [{ op: "replace", path: "/props/subformArrangement", value: "table" }, { op: "add", path: "/props/subformShowHeader", value: true }]);
    expect(source).toEqual({ props: { subformArrangement: "tile" } });
    expect(next).toEqual({ props: { subformArrangement: "table", subformShowHeader: true } });
  });
});
