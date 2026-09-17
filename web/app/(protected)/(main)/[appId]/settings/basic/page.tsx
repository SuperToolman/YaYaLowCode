import AppSettingsPage from "../components/AppSettingsPage";

export default function BasicSettingsPage({ params }: { params: Promise<{ appId: string }> }) {
  return <AppSettingsPage params={params} section="basic" />;
}
