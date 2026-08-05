import { AppToastProvider } from "../components/app-toast-provider";
import { AuthProvider } from "../components/auth-provider";
import { AuthenticatedAppShell } from "../components/authenticated-app-shell";
import { ThemeProvider } from "../components/theme-provider";
import { QueryProvider } from "../components/query-provider";

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
