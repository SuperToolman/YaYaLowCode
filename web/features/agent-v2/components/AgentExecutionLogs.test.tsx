import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ExecutionLogs } from "./AgentToolCallCard";

const mock=vi.hoisted(()=>({read:vi.fn()}));
vi.mock("../client",()=>({readExecutionLogs:mock.read}));
vi.mock("@/shared/providers/ThemeProvider",()=>({useTheme:()=>({appearance:{surfaceVariant:"default"}})}));
afterEach(()=>{cleanup();vi.clearAllMocks()});

it("fetches logs only when requested, using the execution and session identities",async()=>{
  mock.read.mockImplementation(async (_s:string,_e:string,stream:string)=>({text:stream==="stdout"?"installed openpyxl":"",nextOffset:18,done:true,truncated:false}));
  render(<ExecutionLogs sessionId="session" executionId="execution"/>);
  expect(mock.read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"查看执行日志"}));
  await waitFor(()=>expect(screen.getByLabelText("标准输出").textContent).toBe("installed openpyxl"));
  expect(mock.read).toHaveBeenCalledWith("session","execution","stdout",0,expect.any(AbortSignal));
  expect(mock.read).toHaveBeenCalledTimes(2);
});

it("shows truncation and cancels pending reads on unmount",async()=>{
  let signal:AbortSignal|undefined;
  mock.read.mockImplementation(async (_s:string,_e:string,_stream:string,_at:number,abort:AbortSignal)=>{signal=abort;return {text:"bounded",nextOffset:7,done:true,truncated:true}});
  const view=render(<ExecutionLogs sessionId="session" executionId="execution"/>);
  fireEvent.click(screen.getByRole("button",{name:"查看执行日志"}));
  expect(await screen.findByText("日志达到保存上限，部分输出已截断。")).toBeTruthy();
  view.unmount();expect(signal?.aborted).toBe(true);
});
