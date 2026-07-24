import { Card } from "@heroui/react/card";

type SettingsContentCardProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  headerActions?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  bodyScrollable?: boolean;
  footerClassName?: string;
};

export function SettingsContentCard({ title, subtitle, children, headerActions, footer, className = "", headerClassName = "", bodyClassName = "", bodyScrollable = true, footerClassName = "" }: SettingsContentCardProps) {
  return <Card className={`theme-panel flex h-full min-h-0 flex-col !overflow-hidden p-6 shadow-[var(--shadow-card)] ${className}`.trim()} style={{ overflow: "hidden" }}>
    <header className={`shrink-0 flex flex-wrap items-start justify-between gap-4 ${headerClassName}`.trim()}>
      <div>
        <h2 className="text-2xl font-semibold text-[var(--color-text-primary)]">{title}</h2>
        {subtitle ? <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-text-secondary)]">{subtitle}</p> : null}
      </div>
      {headerActions ? <div className="flex shrink-0 items-center gap-2">{headerActions}</div> : null}
    </header>
    <div className={`mt-6 min-h-0 flex-1 ${bodyScrollable ? "overflow-y-auto overscroll-contain" : "!overflow-hidden"} ${bodyClassName}`.trim()}>{children}</div>
    {footer ? <footer className={`mt-6 flex shrink-0 flex-wrap items-center justify-between gap-3 ${footerClassName}`.trim()}>{footer}</footer> : null}
  </Card>;
}
