export default function SkillsSettingsPage() {
  return (
    <section className="theme-panel h-full min-h-0 overflow-y-auto overscroll-contain rounded-[24px] p-6 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Skills</h2>
            <span className="rounded-full bg-[var(--color-info-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-info)]">加载器待实现</span>
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-text-secondary)]">Skill 用于定义 Agent 的任务说明、允许调用的工具、知识库范围以及需要人工确认的操作。</p>
        </div>
        <button type="button" disabled className="h-10 rounded-xl border border-[var(--color-border)] bg-[var(--color-control-soft)] px-4 text-sm font-semibold text-[var(--color-text-primary)] opacity-45">添加 Skill</button>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-[var(--color-border)]">
        <div className="grid grid-cols-[minmax(0,1fr)_110px_110px] gap-3 border-b border-[var(--color-border)] bg-[var(--color-control-soft)] px-4 py-3 text-xs font-semibold text-[var(--color-text-secondary)]">
          <div>Skill</div><div>状态</div><div>版本</div>
        </div>
        {[
          ["表单设计助手", "待接入", "—"],
          ["自动化分析助手", "待接入", "—"],
        ].map(([name, status, version]) => (
          <div key={name} className="grid grid-cols-[minmax(0,1fr)_110px_110px] items-center gap-3 border-b border-[var(--color-border)] px-4 py-4 last:border-b-0">
            <div>
              <div className="text-sm font-medium text-[var(--color-text-primary)]">{name}</div>
              <div className="mt-1 text-xs text-[var(--color-text-secondary)]">声明式 SKILL.md + 工具白名单</div>
            </div>
            <div className="text-xs font-medium text-[var(--color-warning)]">{status}</div>
            <div className="text-xs text-[var(--color-text-secondary)]">{version}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
