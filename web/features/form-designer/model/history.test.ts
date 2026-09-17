import { describe, expect, it } from "vitest";
import {
  commitHistory,
  createHistory,
  redoHistory,
  undoHistory,
} from "./history";

describe("designer history", () => {
  it("stores snapshots independently from mutable editor state", () => {
    const document = { fields: [{ id: "field-1", label: "Name" }] };
    const history = createHistory(document);

    document.fields[0].label = "Changed";

    expect(history.present.fields[0].label).toBe("Name");
  });

  it("undoes and redoes committed states", () => {
    const initial = createHistory({ name: "Version 1" });
    const committed = commitHistory(initial, { name: "Version 2" });
    const undone = undoHistory(committed);

    expect(undone?.present.name).toBe("Version 1");
    expect(undone && redoHistory(undone)?.present.name).toBe("Version 2");
  });

  it("clears the redo branch and respects the history limit", () => {
    const first = commitHistory(null, { version: 1 });
    const second = commitHistory(first, { version: 2 }, 1);
    const undone = undoHistory(second);
    const branched = commitHistory(undone, { version: 3 }, 1);

    expect(branched.past).toEqual([{ version: 1 }]);
    expect(branched.future).toEqual([]);
  });
});
