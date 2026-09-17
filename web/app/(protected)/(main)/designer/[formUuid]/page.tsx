import { DesignerScreen } from "./components/DesignerScreen";

export default async function DesignerPage({
  params,
  searchParams,
}: {
  params: Promise<{ formUuid: string }>;
  searchParams: Promise<{ appId?: string | string[] }>;
}) {
  const [{ formUuid }, query] = await Promise.all([params, searchParams]);
  const appId = typeof query.appId === "string" ? query.appId : null;

  return <DesignerScreen appId={appId} formUuid={formUuid} />;
}
