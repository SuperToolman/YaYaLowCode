import { AutomationsPageClient } from "../../../../../features/automation-editor/management/AutomationsPageClient";

export default async function AutomationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ appId: string }>;
  searchParams: Promise<{ keyword?: string | string[] }>;
}) {
  const { appId } = await params;
  const { keyword } = await searchParams;
  const initialKeyword = typeof keyword === "string" ? keyword : "";

  return (
    <AutomationsPageClient
      key={`${appId}:${initialKeyword}`}
      appId={appId}
      initialKeyword={initialKeyword}
    />
  );
}
