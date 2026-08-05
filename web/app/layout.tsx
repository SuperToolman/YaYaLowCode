import type { Metadata } from "next";
import { WebVitalsReporter } from "./components/web-vitals-reporter";
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
        {children}
        <WebVitalsReporter />
      </body>
    </html>
  );
}
