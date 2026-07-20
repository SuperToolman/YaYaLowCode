import { Card } from "@heroui/react";

type PageHeaderProps = {
  title: string;
  description: string;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
};

export function PageHeader({ actions, description, eyebrow, title }: PageHeaderProps) {
  return (
    <Card className="theme-panel-strong shrink-0 p-5 shadow-[var(--shadow-card)] sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          {eyebrow ? <div className="mb-2 inline-flex items-center gap-2 rounded-md bg-[var(--color-primary-soft)] px-2.5 py-1 text-xs font-medium text-[var(--color-primary)]">{eyebrow}</div> : null}
          <h1 className="text-2xl font-semibold leading-tight text-[var(--color-text-primary)]">{title}</h1>
          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-[var(--color-text-secondary)]">{description}</p>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div> : null}
      </div>
    </Card>
  );
}
