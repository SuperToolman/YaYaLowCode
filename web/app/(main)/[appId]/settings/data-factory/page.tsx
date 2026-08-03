import AppSettingsPage from "../_components/app-settings-page";

export default function DataFactorySettingsPage({ params }: { params: Promise<{ appId: string }> }) {
  return <AppSettingsPage params={params} section="data-factory" />;
}
