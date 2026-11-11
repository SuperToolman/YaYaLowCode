import { describe, expect, it } from "vitest";
import { filterNavigationTree } from "./navigation-utils";
import type { SidebarNode } from "./types";

const navigation: SidebarNode[] = [
  {
    id: "group-customers",
    name: "客户开发",
    itemType: "group",
    parentId: null,
    sortOrder: 0,
    pathSlug: "customers",
    children: [
      {
        id: "form-prospects",
        name: "意向客户",
        itemType: "form",
        parentId: "group-customers",
        sortOrder: 0,
        pathSlug: "prospects",
        children: [],
      },
    ],
  },
  {
    id: "form-orders",
    name: "订单",
    itemType: "form",
    parentId: null,
    sortOrder: 1,
    pathSlug: "orders",
    children: [],
  },
];

describe("filterNavigationTree", () => {
  it("keeps matching forms and their group ancestors", () => {
    expect(filterNavigationTree(navigation, "意向")).toEqual([
      {
        ...navigation[0],
        children: [navigation[0].children[0]],
      },
    ]);
  });

  it("returns the complete tree when the query is empty", () => {
    expect(filterNavigationTree(navigation, "  ")).toBe(navigation);
  });
});
