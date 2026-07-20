import { AutomationsPageClient } from "./automations-page-client";

export default async function AutomationsPage({
  params,
}: {
  params: Promise<{ appId: string }>;
}) {
  const { appId } = await params;

  return <AutomationsPageClient appId={appId} />;
}
