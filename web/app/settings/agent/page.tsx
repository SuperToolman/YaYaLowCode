import { redirect } from "next/navigation";

export default function LegacyAgentSettingsPage() {
  redirect("/settings/agents");
}
