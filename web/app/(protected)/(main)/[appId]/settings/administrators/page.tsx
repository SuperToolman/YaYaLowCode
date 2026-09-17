import AppSettingsPage from "../components/AppSettingsPage";

export default function AdministratorSettingsPage({ params }: { params: Promise<{ appId: string }> }) {
  return <AppSettingsPage params={params} section="administrators" />;
}
