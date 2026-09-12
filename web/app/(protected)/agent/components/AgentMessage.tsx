"use client";

import { FaceRobot } from "@gravity-ui/icons";
import { AgentMarkdown } from "@/app/components/agent/AgentMarkdown";
import { MySurface } from "../../../components/my-fields/MySurface";
import type { AgentMessage as Message, AgentTimelineItem } from "@/features/agent-assistant/types";
import { agentFileDownloadUrl } from "@/features/agent-assistant/api";
import { ThinkBlock } from "./ThinkBlock";
import { ToolCallCard } from "./ToolCallCard";

export function AgentMessage({ message, loading }: { message: Message; loading?: boolean }) {
  if (message.role === "user") return <MySurface className="w-fit max-w-[85%] self-end rounded-2xl bg-accent/12 px-4 py-3 text-foreground"><AgentMarkdown content={message.content} />{message.files?.length ? <div className="mt-2 flex flex-wrap gap-2 border-t border-current/15 pt-2 text-xs">{message.files.map((file) => <a key={file.id} className="rounded bg-background/40 px-2 py-1 underline" href={message.sessionId ? agentFileDownloadUrl(message.sessionId, file.id) : "#"} target="_blank" rel="noreferrer">{file.name}</a>)}</div> : null}</MySurface>;
  const blocks = message.timeline ?? buildBlocks(message);
  return <MySurface className="w-full min-w-0 self-start overflow-hidden rounded-2xl px-4 py-3"><div className="flex min-h-8 items-center gap-2 text-sm font-semibold text-muted"><FaceRobot className="size-5 text-accent" /><span>{loading && !message.content ? "正在思考" : "Agent"}</span></div><div className="min-w-0 pt-2">{blocks.map((block, index) => block.type === "reasoning" ? <ThinkBlock key={block.id} text={block.text} index={index} /> : block.type === "tool" ? <ToolCallCard key={block.id} activity={block.activity} /> : <AgentMarkdown key={block.id} content={block.text} />)}{message.files?.length ? <div className="mt-3 flex flex-wrap gap-2 border-t border-current/15 pt-2 text-xs">{message.files.map((file) => <a key={file.id} className="rounded bg-background/40 px-2 py-1 underline" href={message.sessionId ? agentFileDownloadUrl(message.sessionId, file.id) : "#"} target="_blank" rel="noreferrer">📎 {file.name} · {file.mimeType} · {file.size} B</a>)}</div> : null}{loading && !blocks.length ? <span className="block size-2 animate-pulse rounded-full bg-accent" aria-label="正在思考" /> : null}</div></MySurface>;
}

function buildBlocks(message: Message): AgentTimelineItem[] {
  const blocks: AgentTimelineItem[] = [];
  if (message.reasoning) blocks.push({ id: `${message.id}-reasoning`, type: "reasoning", text: message.reasoning });
  for (const activity of message.toolActivities ?? []) blocks.push({ id: activity.id, type: "tool", activity });
  if (message.content) blocks.push({ id: `${message.id}-answer`, type: "answer", text: message.content });
  return blocks;
}
