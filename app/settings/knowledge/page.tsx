export default function KnowledgeSettingsPage() {
  return (
    <section className="theme-panel h-full min-h-0 overflow-y-auto overscroll-contain rounded-[24px] p-6 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">知识库</h2>
            <span className="rounded-full bg-[var(--color-warning-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-warning)]">规划中</span>
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-text-secondary)]">
            管理 Agent 可检索的产品文档、业务说明和操作规范。后续将使用 PostgreSQL + pgvector 实现混合检索。
          </p>
        </div>
        <button type="button" disabled className="h-10 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-semibold text-[var(--color-text-on-primary)] opacity-45">创建知识库</button>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {[
          ["知识库集合", "0", "用于按应用和 Skill 隔离知识范围"],
          ["已处理文档", "0", "支持 PDF、Word、Markdown 等文档"],
          ["向量索引", "未启用", "等待 pgvector 和 Embedding 接入"],
        ].map(([label, value, description]) => (
          <div key={label} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-control-soft)] p-4">
            <div className="text-xs font-medium text-[var(--color-text-secondary)]">{label}</div>
            <div className="mt-2 text-xl font-semibold text-[var(--color-text-primary)]">{value}</div>
            <p className="mt-2 text-xs leading-5 text-[var(--color-text-secondary)]">{description}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-5 py-8 text-center">
        <div className="text-sm font-semibold text-[var(--color-text-primary)]">暂无知识库</div>
        <p className="mt-2 text-xs leading-5 text-[var(--color-text-secondary)]">当前 Agent MVP 使用表单与自动化只读工具获取结构化信息，尚未启用非结构化文档检索。</p>
      </div>
    </section>
  );
}
