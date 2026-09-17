import AppSettingsPage from "../components/AppSettingsPage";

export default function FormSettingsPage({ params }: { params: Promise<{ appId: string }> }) {
  return <AppSettingsPage params={params} section="forms" />;
}
