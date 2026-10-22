export type FormSidebarProps = {
  routeAppId: string;
};

export type NavigationItem = {
  id: string;
  itemType: "form" | "system" | "group" | "link";
  targetFormUuid?: string | null;
  title: string;
  pathSlug: string;
  sortOrder: number;
  isDefaultEntry: boolean;
  parentId?: string | null;
  formType?: "normal" | "workflow" | "defined" | "detail";
};

export type SidebarNode = {
  id: string;
  name: string;
  href?: string;
  itemType: NavigationItem["itemType"];
  parentId?: string | null;
  sortOrder: number;
  targetFormUuid?: string | null;
  pathSlug: string;
  formType?: NavigationItem["formType"];
  children: SidebarNode[];
};

export type NavigationDragData = {
  kind: "navigation-item";
  itemId: string;
};

export type NavigationDropData = {
  kind: "navigation-drop";
  targetId: string;
  placement: "before" | "after" | "inside";
};

export type GroupAction = "rename" | "move" | "delete" | "copy";
export type FormAction = "rename" | "move" | "delete" | "copy";
export type DragState = {
  itemId: string;
  targetId?: string;
  placement?: NavigationDropData["placement"];
} | null;
