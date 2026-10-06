import { AppToastProvider } from "../components/AppToastProvider";
import { AuthProvider } from "../components/AuthProvider";
import { AuthenticatedAppShell } from "../components/AuthenticatedAppShell";
import { ThemeProvider } from "@shared/ThemeProvider";
import { QueryProvider } from "../components/QueryProvider";
import { AgentWorkbenchRuntimeProvider } from "@/features/agent-workbench/runtime";
import { WorkflowToastListener } from "../components/WorkflowToastListener";

export default function ProtectedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <ThemeProvider>
      <QueryProvider>
        <AuthProvider>
          <WorkflowToastListener />
          <AgentWorkbenchRuntimeProvider>
            <AuthenticatedAppShell>{children}</AuthenticatedAppShell>
          </AgentWorkbenchRuntimeProvider>
        </AuthProvider>
        <AppToastProvider />
      </QueryProvider>
    </ThemeProvider>
  );
}
