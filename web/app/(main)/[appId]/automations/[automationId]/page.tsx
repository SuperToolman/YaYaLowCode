import { AutomationEditorPageClient } from "./page-client";

export default async function AutomationEditorPage({
  params,
}: {
  params: Promise<{ appId: string; automationId: string }>;
}) {
  const { appId, automationId } = await params;

  return <AutomationEditorPageClient appId={appId} automationId={automationId} />;
}
