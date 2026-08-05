import AppSettingsPage from "../_components/app-settings-page";

export default function AdministratorSettingsPage({ params }: { params: Promise<{ appId: string }> }) {
  return <AppSettingsPage params={params} section="administrators" />;
}
