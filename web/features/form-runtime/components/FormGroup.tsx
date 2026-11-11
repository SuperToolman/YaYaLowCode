import type { ComponentProps, ReactNode } from "react";
import { Typography } from "@heroui/react";

import { type GroupTitleType, type GroupStyle } from "@/features/form-model/presentation-options";
export { groupTitleTypeOptions, groupStyleOptions, type GroupTitleType, type GroupStyle } from "@/features/form-model/presentation-options";

const groupStyleClasses: Record<GroupStyle, string> = {
  simple: "p-2",
  surface: "rounded-[var(--radius-lg,16px)] bg-[var(--surface)] p-3 shadow-[var(--shadow-card-glass)]",
  bordered: "rounded-[var(--radius-lg,16px)] border border-[var(--color-border)] p-3",
  divider: "py-2",
};

export function FormGroup({
  title,
  description,
  groupStyle = "simple",
  groupTitleType = "h4",
  children,
  className,
  ...props
}: Omit<ComponentProps<"div">, "title"> & {
  title: ReactNode;
  description?: string;
  groupStyle?: GroupStyle;
  groupTitleType?: GroupTitleType;
}) {
  return (
    <div
      {...props}
      data-group-style={groupStyle}
      className={`w-full min-w-0 ${groupStyleClasses[groupStyle]} ${className ?? ""}`}
    >
      <div className={`mb-2 [overflow-wrap:anywhere] ${groupStyle === "divider" ? "border-b border-[var(--color-border)] pb-2" : ""}`}>
        <Typography type={groupTitleType}>{title}</Typography>
        {description ? <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}
