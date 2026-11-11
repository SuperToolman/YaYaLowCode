import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { AgentToolActivity } from "../types";
import { ToolCallCard } from "./AgentToolCallCard";

afterEach(cleanup);

it("shows the original Python traceback for a failed script", () => {
  const traceback = `Traceback (most recent call last):\n  File "main.py", line 8, in <module>\n    print(rows[0])\nIndexError: list index out of range`;
  const activity: AgentToolActivity = {
    id: "run:call",
    name: "workspace_execute_code",
    status: "failed",
    executionStatus: "failed",
    result: { exitCode: 1, stdout: "partial output", stderr: traceback },
  };

  render(<ToolCallCard activity={activity} />);
  fireEvent.click(screen.getByRole("button", { name: /脚本执行失败/ }));

  expect(screen.getByRole("alert").textContent).toContain(traceback);
  expect(screen.getByText("异常信息")).toBeTruthy();
});

it("does not replace the thrown error with a short reason", () => {
  const thrown = "Error: connection reset by peer";
  const activity: AgentToolActivity = {
    id: "run:call",
    name: "workspace_execute_code",
    status: "failed",
    executionStatus: "failed",
    result: { result: { stderr: thrown } },
    error: { message: "脚本失败" },
  };

  render(<ToolCallCard activity={activity} />);
  fireEvent.click(screen.getByRole("button", { name: /脚本执行失败/ }));

  expect(screen.getByRole("alert").textContent).toContain(thrown);
  expect(screen.getByRole("alert").textContent).not.toContain("脚本失败");
});
