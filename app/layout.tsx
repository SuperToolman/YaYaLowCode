import type { Metadata } from "next";
import Script from "next/script";
import { AppToastProvider } from "./components/app-toast-provider";
import HomeSideBar from "./components/HomeSideBar";
import { ThemeProvider } from "./components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "丫丫LowCode",
  description: "丫丫LowCode 首页",
};

const themeInitScript = `
(() => {
  const storageKey = "yaya-theme-mode";
  const savedTheme = localStorage.getItem(storageKey);
  const theme = savedTheme === "light" || savedTheme === "dark" || savedTheme === "system"
    ? savedTheme
    : "system";
  const resolvedTheme = theme === "system"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.resolvedTheme = resolvedTheme;
  root.style.colorScheme = resolvedTheme;
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <Script id="theme-init" strategy="beforeInteractive">
          {themeInitScript}
        </Script>
      </head>
      <body className="min-h-full">
        <ThemeProvider>
          <div className="app-root-shell">
            <HomeSideBar />
            <div className="app-main-region">
              <div className="app-main-glass">{children}</div>
            </div>
          </div>
          <AppToastProvider />
        </ThemeProvider>
      </body>
    </html>
  );
}
