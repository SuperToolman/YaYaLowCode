"use client";

import type { ComponentProps } from "react";
import { Surface } from "@heroui/react";
import { useTheme } from "./theme-provider";

type MySurfaceProps = ComponentProps<typeof Surface>;

/** Project surface that follows the user's global Surface preference by default. */
export function MySurface({ variant, ...props }: MySurfaceProps) {
  const { appearance } = useTheme();
  return <Surface {...props} variant={variant ?? appearance.surfaceVariant} />;
}

