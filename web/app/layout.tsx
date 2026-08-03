import type { Metadata } from "next";
import { AppToastProvider } from "./components/app-toast-provider";
import { AuthenticatedAppShell } from "./components/authenticated-app-shell";
import { ThemeProvider } from "./components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "丫丫LowCode",
  description: "丫丫LowCode 首页",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full">
        <ThemeProvider>
          <AuthenticatedAppShell>{children}</AuthenticatedAppShell>
          <AppToastProvider />
        </ThemeProvider>
      </body>
    </html>
  );
}
