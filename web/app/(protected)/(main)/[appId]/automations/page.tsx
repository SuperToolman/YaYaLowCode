import { AutomationsPageClient } from "./components/AutomationsPageClient";

export default async function AutomationsPage({
  params,
}: {
  params: Promise<{ appId: string }>;
}) {
  const { appId } = await params;

  return <AutomationsPageClient appId={appId} />;
}
