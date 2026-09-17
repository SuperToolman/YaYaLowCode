import AppSettingsPage from "../components/AppSettingsPage";

export default function PermissionSettingsPage({ params }: { params: Promise<{ appId: string }> }) {
  return <AppSettingsPage params={params} section="permissions" />;
}
