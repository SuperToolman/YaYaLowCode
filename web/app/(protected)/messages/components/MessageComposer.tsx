import type { ReactNode } from "react";

export function MessageComposer({ children }: { children: ReactNode }) {
  return <footer className="shrink-0">{children}</footer>;
}
