import { Separator } from "@heroui/react";
import type { CSSProperties } from "react";

import { type SeparatorStyle, type SeparatorVariant, type SeparatorOrientation } from "@/features/form-model/presentation-options";
export { separatorOrientationOptions, separatorStyleOptions, separatorVariantOptions, type SeparatorStyle, type SeparatorVariant, type SeparatorOrientation } from "@/features/form-model/presentation-options";

const variantColors: Record<SeparatorVariant, string> = {
  default: "var(--separator)",
  secondary: "var(--separator-secondary)",
  tertiary: "var(--separator-tertiary)",
};

/** Shared by the designer, editing renderer and static read-only renderer. */
export function FormSeparator({
  label,
  description,
  separatorStyle = "solid",
  separatorVariant = "default",
  orientation = "horizontal",
}: {
  label: string;
  description?: string;
  separatorStyle?: SeparatorStyle;
  separatorVariant?: SeparatorVariant;
  orientation?: SeparatorOrientation;
}) {
  const vertical = orientation === "vertical";
  const color = variantColors[separatorVariant];
  // Explicit patterns keep dashes and dots distinct at any length or orientation.
  // Dashed: 10px strokes / 6px gaps; dotted: 1px dots / 8px pitch.
  const thickness = 1;
  const lineStyle: CSSProperties = {
    border: 0,
    borderRadius: 0,
    ...(vertical
      ? { width: thickness, height: "auto", minHeight: 48, alignSelf: "stretch" }
      : { width: "100%", height: thickness }),
    flexShrink: 0,
    ...(separatorStyle === "solid" ? {} : {
      backgroundColor: "transparent",
      backgroundImage: separatorStyle === "dashed"
        ? `repeating-linear-gradient(to ${vertical ? "bottom" : "right"}, ${color} 0 10px, transparent 10px 16px)`
        : `radial-gradient(circle at center, ${color} 0.5px, transparent 0.5px)`,
      backgroundSize: separatorStyle === "dotted" ? (vertical ? "1px 8px" : "8px 1px") : undefined,
      backgroundRepeat: vertical ? "repeat-y" : "repeat-x",
      backgroundPosition: "center",
    }),
  };

  return (
    <div
      className={vertical
        ? "flex h-full min-h-12 w-full min-w-0 self-stretch items-center justify-center gap-2 px-2"
        : "flex min-h-6 w-full min-w-0 self-stretch flex-col justify-center gap-2 py-2"}
      data-separator-style={separatorStyle}
    >
      <Separator
        aria-label={label}
        orientation={orientation}
        variant={separatorVariant}
        style={lineStyle}
      />
      {description ? <p className="text-xs text-[var(--color-text-secondary)]">{description}</p> : null}
    </div>
  );
}
