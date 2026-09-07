import type { ReactNode } from "react";
import { Card } from "@heroui/react";

type PageContentLayoutProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  center?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * Shared content frame for top-level application pages.
 * HeroUI controls can be supplied through the center and actions slots.
 */
export function PageContentLayout({
  actions,
  center,
  children,
  className,
  subtitle,
  title,
}: PageContentLayoutProps) {
  return (
    <div className={`flex h-full min-h-0 flex-col ${className ?? ""}`}>
      <header className="shrink-0 pb-2">
        <div className="grid gap-3 lg:grid-cols-[minmax(14rem,1fr)_minmax(16rem,28rem)_minmax(14rem,1fr)] lg:items-center">
          <div className="min-w-0">
            <h1 className="page-content-layout__title">{title}</h1>
            {subtitle ? <p className="page-content-layout__subtitle">{subtitle}</p> : null}
          </div>
          {center ? <div className="min-w-0 lg:justify-self-stretch">{center}</div> : <div className="hidden lg:block" />}
          {actions ? <div className="flex flex-wrap items-center gap-2 lg:justify-self-end lg:justify-end">{actions}</div> : null}
        </div>
      </header>
      <div className="min-h-0 flex-1">
        {children}
      </div>
    </div>
  );
}
