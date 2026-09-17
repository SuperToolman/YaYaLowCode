import { FormRecordsScreen } from "./components/FormRecordsScreen";

export default async function FormRecordsPage({
  params,
}: {
  params: Promise<{ appId: string; formUuid: string }>;
}) {
  const { appId, formUuid } = await params;

  return <FormRecordsScreen appId={appId} formUuid={formUuid} />;
}
