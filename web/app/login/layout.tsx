import { ThemeProvider } from "@shared/ThemeProvider";
import { AppToastProvider } from "../components/AppToastProvider";

export default function LoginLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ThemeProvider>{children}<AppToastProvider /></ThemeProvider>;
}
