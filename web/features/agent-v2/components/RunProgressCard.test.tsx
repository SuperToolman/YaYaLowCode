import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RunProgressCard } from "./RunProgressCard";
vi.mock("@/shared/providers/ThemeProvider",()=>({useTheme:()=>({appearance:{surfaceVariant:"default"}})}));
afterEach(cleanup);
const run={runId:"test",status:"running",budget_ms:43200000,active_ms:43200000,model_limit:1000,model_requests:1000,stage:2,pause_reason:null,stop_pending:false};
it("does not show budgets or continuation controls during normal execution",()=>{
 const {container}=render(<RunProgressCard run={run} disabled={false} onStop={vi.fn()}/>);
 expect(container.textContent).toBe("");
});
it("does not ask users to approve recovery or replay uncertain script results",()=>{
 const stop=vi.fn();
 const {rerender}=render(<RunProgressCard run={{...run,status:"paused",pause_reason:"context_unshrinkable"}} disabled={false} onStop={stop}/>);
 expect(screen.queryByRole("button",{name:/继续/})).toBeNull();
 expect(screen.getByText("正在自动恢复任务。")).toBeTruthy();
 rerender(<RunProgressCard run={{...run,status:"manual_review",pause_reason:"outcome_unknown"}} disabled={false} onStop={stop}/>);
 expect(screen.queryByRole("button",{name:/继续/})).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"停止任务"}));expect(stop).toHaveBeenCalledOnce();
});
