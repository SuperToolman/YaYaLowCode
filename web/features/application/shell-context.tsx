"use client";
import { createContext, useContext } from "react";

export const AppShellContext = createContext<{
  collapsed: boolean;
  toggleCollapsed: () => void;
  headerActionsTarget: HTMLDivElement | null;
  setHeaderActionsTarget: (target: HTMLDivElement | null) => void;
} | null>(null);
export function useAppShellSidebar() {
  const context = useContext(AppShellContext);
  if (!context)
    throw new Error("useAppShellSidebar must be used within AppShell");
  return context;
}
export function useAppHeaderActions() {
  const context = useContext(AppShellContext);
  if (!context)
    throw new Error("useAppHeaderActions must be used within AppShell");
  return context;
}
