import { AutomationEditorPageClient } from "@/features/automation-editor/components";

export default async function AutomationEditorPage({
  params,
}: {
  params: Promise<{ appId: string; automationId: string }>;
}) {
  const { appId, automationId } = await params;

  return <AutomationEditorPageClient appId={appId} automationId={automationId} />;
}
