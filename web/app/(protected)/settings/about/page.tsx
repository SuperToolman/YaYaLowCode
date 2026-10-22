import { loadPlatformChangelog } from "@features/settings/server/changelog";
import AboutPlatformClient from "./AboutPlatformClient";

export const dynamic = "force-dynamic";

export default async function AboutPlatformPage() {
  let changelog: { markdown: string; version: string | null } | null = null;
  try {
    changelog = await loadPlatformChangelog();
  } catch {
    // A missing release document must not prevent viewing runtime or license status.
  }
  return <AboutPlatformClient changelog={changelog} />;
}
