"use client";

import { useRouter } from "next/navigation";
import { ComposeMailWorkbench } from "./components/ComposeMailWorkbench";

export default function SendMailPage() {
  const router = useRouter();
  return <ComposeMailWorkbench onCancel={() => router.push("/mail")} onSent={() => router.push("/mail/sent")} />;
}
