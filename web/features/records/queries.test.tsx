import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { describe, expect, it } from "vitest";
import { useAssociationFormsQuery } from "./queries";

describe("association form query", () => {
  it("retains the map while data is unchanged and refreshes it when data changes", () => {
    const client = new QueryClient();
    const first = { schema: {}, records: new Map() };
    client.setQueryData(["association-form", "related"], first);
    const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result, rerender } = renderHook(({ ids }) => useAssociationFormsQuery(ids), {
      wrapper,
      initialProps: { ids: ["related"] },
    });
    const original = result.current;
    rerender({ ids: ["related"] });
    expect(result.current).toBe(original);
    expect(result.current.get("related")).toBe(first);

    const updated = { schema: {}, records: new Map([["entry", { id: "entry" }]]) };
    act(() => client.setQueryData(["association-form", "related"], updated));
    rerender({ ids: ["related"] });
    expect(result.current).not.toBe(original);
    expect(result.current.get("related")).toMatchObject({ records: updated.records });
  });
});
