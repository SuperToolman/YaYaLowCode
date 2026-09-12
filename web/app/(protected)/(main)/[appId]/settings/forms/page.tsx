import AppSettingsPage from "../_components/AppSettingsPage";

export default function FormSettingsPage({ params }: { params: Promise<{ appId: string }> }) {
  return <AppSettingsPage params={params} section="forms" />;
}
