"use client";
import { Button } from "@heroui/react";
import { ArrowChevronLeft, ArrowChevronRight } from "@gravity-ui/icons";
import { usePathname } from "next/navigation";
import { useAppShellSidebar } from "./AppShell";
export function AppSidebarToggle() { const pathname = usePathname(); const { collapsed, toggleCollapsed } = useAppShellSidebar(); if (/\/automations\/[^/]+$/.test(pathname) || /\/settings(?:\/|$)/.test(pathname)) return null; return <Button isIconOnly aria-label={collapsed ? "展开表单导航" : "收起表单导航"} onPress={toggleCollapsed} className="h-9 w-9 shrink-0 text-[var(--color-text-secondary)]">{collapsed ? <ArrowChevronRight /> : <ArrowChevronLeft />}</Button>; }
