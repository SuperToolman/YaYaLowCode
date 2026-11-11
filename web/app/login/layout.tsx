import { ThemeProvider } from "@/shared/providers/ThemeProvider";
import { AppToastProvider } from "../../shared/providers/AppToastProvider";

export default function LoginLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ThemeProvider>{children}<AppToastProvider /></ThemeProvider>;
}
