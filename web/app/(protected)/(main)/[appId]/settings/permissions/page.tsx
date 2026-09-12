import AppSettingsPage from "../_components/AppSettingsPage";

export default function PermissionSettingsPage({ params }: { params: Promise<{ appId: string }> }) {
  return <AppSettingsPage params={params} section="permissions" />;
}
