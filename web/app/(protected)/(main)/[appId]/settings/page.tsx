import { redirect } from "next/navigation";

export default async function AppSettingsIndexPage({
  params,
}: {
  params: Promise<{ appId: string }>;
}) {
  const { appId } = await params;
  redirect(`/${appId}/settings/basic`);
}
