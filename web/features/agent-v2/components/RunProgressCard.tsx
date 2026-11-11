"use client";
import { Button } from "@heroui/react";
import { Stop } from "@gravity-ui/icons";
import { MySurface } from "@/shared/ui/MySurface";
import type { AgentV2RunProgress } from "@/shared/lib/http";

export function RunProgressCard({run,disabled,onStop}:{run:AgentV2RunProgress & {runId:string};disabled:boolean;onStop:()=>void}) {
  if (!["paused","manual_review"].includes(run.status)) return null;
  return <MySurface className="flex flex-col gap-2" aria-label="任务状态">
    <p role="status">{run.status==="manual_review" ? "上次脚本的执行结果尚无法确认，请核对执行记录，避免重复操作。" : "正在自动恢复任务。"}</p>
    <Button isDisabled={disabled} onPress={onStop}><Stop />停止任务</Button>
  </MySurface>;
}
