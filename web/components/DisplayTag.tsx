"use client";

import { Tag, TagGroup } from "@heroui/react";
import type { ReactNode } from "react";

type DisplayTagProps = {
  children: ReactNode;
  color?: "default" | "accent" | "success" | "warning" | "danger";
};

/** Non-interactive label. TagGroup supplies the context required by HeroUI Tag. */
export function DisplayTag({ children, color = "default" }: DisplayTagProps) {
  return (
    <TagGroup aria-label="标签" selectionMode="none" style={{ display: "inline-flex" }}>
      <TagGroup.List>
        <Tag
          id="label"
          textValue={String(children)}
          style={{
            cursor: "default",
            backgroundColor: `var(--${color}-soft)`,
            color: `var(--${color}-soft-foreground)`,
          }}
        >
          {children}
        </Tag>
      </TagGroup.List>
    </TagGroup>
  );
}
