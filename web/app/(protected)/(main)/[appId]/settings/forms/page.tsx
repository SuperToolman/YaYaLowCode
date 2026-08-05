import AppSettingsPage from "../_components/app-settings-page";

export default function FormSettingsPage({ params }: { params: Promise<{ appId: string }> }) {
  return <AppSettingsPage params={params} section="forms" />;
}
