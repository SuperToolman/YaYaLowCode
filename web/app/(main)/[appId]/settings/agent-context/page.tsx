import AppSettingsPage from "../_components/app-settings-page";

export default function AgentContextSettingsPage({ params }: { params: Promise<{ appId: string }> }) {
  return <AppSettingsPage params={params} section="agent-context" />;
}
