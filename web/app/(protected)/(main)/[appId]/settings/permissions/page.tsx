import AppSettingsPage from "../_components/app-settings-page";

export default function PermissionSettingsPage({ params }: { params: Promise<{ appId: string }> }) {
  return <AppSettingsPage params={params} section="permissions" />;
}
