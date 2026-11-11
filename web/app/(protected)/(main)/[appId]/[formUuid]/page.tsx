import { RecordsWorkspace } from "@/features/records/screen/RecordsWorkspace";

export default async function FormRecordsPage({
  params,
}: {
  params: Promise<{ appId: string; formUuid: string }>;
}) {
  const { appId, formUuid } = await params;

  return <RecordsWorkspace appId={appId} formUuid={formUuid} />;
}
