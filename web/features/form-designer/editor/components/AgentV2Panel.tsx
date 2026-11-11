"use client";
import Link from "next/link";

export function AgentV2Panel() {
  return <div className="flex flex-col gap-3">
    <p>请在 AgentV2 工作台选择 AI 员工并处理表单设计任务。</p>
    <p>表单内对话和草稿回填尚未接入 AgentV2。</p>
    <Link href="/agent-v2">打开 AgentV2</Link>
  </div>;
}
