import { Card } from "@heroui/react/card";
import { Typography } from "@heroui/react";

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

export function SettingsContentCard({
  title,
  subtitle,
  children,
  headerActions,
  footer,
  className = "",
  headerClassName = "",
  bodyClassName = "",
  bodyScrollable = true,
  footerClassName = "",
}: SettingsContentCardProps) {
  return (
    <Card className={`h-full ${className}`.trim()} style={{ overflow: "clip" }}>
      <header
        className={`shrink-0 flex flex-wrap items-start justify-between gap-4 ${headerClassName}`.trim()}
      >
        <div className="flex items-end gap-2">
          <Typography type="h3">{title}</Typography>
          <Typography type="body-sm">{subtitle}</Typography>
        </div>
        {headerActions ? (
          <div className="flex shrink-0 items-center gap-2">
            {headerActions}
          </div>
        ) : null}
      </header>
      <div
        className={`min-h-0 flex-1 ${bodyScrollable ? "overflow-y-auto overscroll-contain" : "!overflow-clip"} ${bodyClassName}`.trim()}
      >
        {children}
      </div>
      {footer ? (
        <footer
          className={`mt-6 flex shrink-0 flex-wrap items-center justify-between gap-3 ${footerClassName}`.trim()}
        >
          {footer}
        </footer>
      ) : null}
    </Card>
  );
}
