import Link from "next/link";
import { Magnifier } from "@gravity-ui/icons";
import { SettingsContentCard } from "../_components/settings-content-card";

export default function AiEmployeeMarketPage() {
  return (
    <SettingsContentCard
      title="AI员工市场"
      subtitle="浏览平台提供的 AI 员工，并将其安装到当前客户环境。"
      headerActions={<Link className="inline-flex h-9 items-center rounded-md border border-[var(--color-border)] px-4 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]" href="/settings/ai-employees">已安装</Link>}
    >
      <div className="flex min-h-72 flex-col items-center justify-center border-y border-[var(--color-border)] px-6 py-12 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-md bg-[var(--color-control-soft)] text-[var(--color-text-secondary)]">
          <Magnifier className="h-6 w-6" />
        </span>
        <h3 className="mt-4 text-base font-semibold text-[var(--color-text-primary)]">暂无可用的 AI 员工</h3>
      </div>
    </SettingsContentCard>
  );
}
