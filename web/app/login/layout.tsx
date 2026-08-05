import { ThemeProvider } from "../components/theme-provider";

export default function LoginLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ThemeProvider>{children}</ThemeProvider>;
}
