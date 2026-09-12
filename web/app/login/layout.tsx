import { ThemeProvider } from "../components/ThemeProvider";

export default function LoginLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ThemeProvider>{children}</ThemeProvider>;
}
