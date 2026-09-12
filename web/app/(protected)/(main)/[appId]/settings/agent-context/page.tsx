import AppSettingsPage from "../_components/AppSettingsPage";

export default function AgentContextSettingsPage({ params }: { params: Promise<{ appId: string }> }) {
  return <AppSettingsPage params={params} section="agent-context" />;
}
