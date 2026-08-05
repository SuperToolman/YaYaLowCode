import Link from "next/link";
import { FaceRobot } from "@gravity-ui/icons";
import { SettingsContentCard } from "../_components/settings-content-card";

export default function AiEmployeesPage() {
  return (
    <SettingsContentCard
      title="AI员工列表"
      subtitle="管理当前平台已安装并可交付使用的 AI 员工。"
      headerActions={<Link className="inline-flex h-9 items-center rounded-md bg-[var(--color-primary)] px-4 text-sm font-medium text-[var(--color-text-on-primary)] transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]" href="/settings/ai-employee-market">浏览市场</Link>}
    >
      <div className="flex min-h-72 flex-col items-center justify-center border-y border-[var(--color-border)] px-6 py-12 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-md bg-[var(--color-primary-soft)] text-[var(--color-primary)]">
          <FaceRobot className="h-6 w-6" />
        </span>
        <h3 className="mt-4 text-base font-semibold text-[var(--color-text-primary)]">暂无已安装的 AI 员工</h3>
        <Link className="mt-5 text-sm font-medium text-[var(--color-primary)] hover:underline" href="/settings/ai-employee-market">前往 AI 员工市场</Link>
      </div>
    </SettingsContentCard>
  );
}
