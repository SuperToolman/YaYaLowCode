import type { ReactNode } from "react";

export default function SettingsPage({ group, title, description, actions, children }: { group: string; title: string; description: string; actions?: ReactNode; children: ReactNode }) {
  return <div><header className="flex flex-col gap-4 border-b border-border pb-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="text-xs font-medium uppercase tracking-[0.22em] text-muted">{group}</p><h1 className="mt-2 text-2xl font-semibold text-foreground">{title}</h1><p className="text-sm leading-6 text-muted">{description}</p></div>{actions ? <div className="flex shrink-0 items-center gap-3 sm:pt-1">{actions}</div> : null}</header><div className="pt-6">{children}</div></div>;
}
