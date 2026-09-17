import { AppToastProvider } from "../components/AppToastProvider";
import { AuthProvider } from "../components/AuthProvider";
import { AuthenticatedAppShell } from "../components/AuthenticatedAppShell";
import { ThemeProvider } from "@shared/ThemeProvider";
import { QueryProvider } from "../components/QueryProvider";

export default function ProtectedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <ThemeProvider>
      <QueryProvider>
        <AuthProvider>
          <AuthenticatedAppShell>{children}</AuthenticatedAppShell>
        </AuthProvider>
        <AppToastProvider />
      </QueryProvider>
    </ThemeProvider>
  );
}
