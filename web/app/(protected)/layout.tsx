import { AppToastProvider } from "../../shared/providers/AppToastProvider";
import { AuthProvider } from "../../features/auth/components/AuthProvider";
import { AuthenticatedAppShell } from "../_components/AuthenticatedAppShell";
import { ThemeProvider } from "@/shared/providers/ThemeProvider";
import { QueryProvider } from "../../shared/providers/QueryProvider";
import { WorkflowToastListener } from "../../features/workflow/components/WorkflowToastListener";

export default function ProtectedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <ThemeProvider>
      <QueryProvider>
        <AuthProvider>
          <WorkflowToastListener />
            <AuthenticatedAppShell>{children}</AuthenticatedAppShell>
        </AuthProvider>
        <AppToastProvider />
      </QueryProvider>
    </ThemeProvider>
  );
}
