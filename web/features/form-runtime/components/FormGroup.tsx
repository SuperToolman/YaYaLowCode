import type { ComponentProps, ReactNode } from "react";

export const groupStyleOptions = [
  { value: "simple", label: "简约" },
  { value: "surface", label: "Surface" },
  { value: "bordered", label: "边框" },
  { value: "divider", label: "分割线" },
] as const;

export type GroupStyle = (typeof groupStyleOptions)[number]["value"];

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
  children,
  className,
  ...props
}: Omit<ComponentProps<"div">, "title"> & {
  title: ReactNode;
  description?: string;
  groupStyle?: GroupStyle;
}) {
  return (
    <div
      {...props}
      data-group-style={groupStyle}
      className={`w-full min-w-0 ${groupStyleClasses[groupStyle]} ${className ?? ""}`}
    >
      <div className={`mb-2 [overflow-wrap:anywhere] ${groupStyle === "divider" ? "border-b border-[var(--color-border)] pb-2" : ""}`}>
        <div className="text-sm font-semibold">{title}</div>
        {description ? <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}
