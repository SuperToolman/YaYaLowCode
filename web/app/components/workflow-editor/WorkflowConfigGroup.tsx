"use client";

import { useId, type ReactNode } from "react";
import { Description } from "@heroui/react/description";
import { Separator } from "@heroui/react/separator";
import { MySurface } from "@/components/ui/MySurface";

export type WorkflowConfigGroupProps = {
  title: ReactNode;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
};

export function WorkflowConfigGroup({
  title,
  description,
  actions,
  children,
}: WorkflowConfigGroupProps) {
  const titleId = useId();

  return (
    <MySurface role="region" aria-labelledby={titleId} className="shadow-lg">
      <div className="p-2">
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="text-sm font-semibold break-words">
            {title}
          </h3>
          {description ? <Description>{description}</Description> : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-1">{actions}</div>
        ) : null}
      </div>
      {children != null ? (
        <>
          <Separator />
          <div className="space-y-2 p-2">{children}</div>
        </>
      ) : null}
    </MySurface>
  );
}
