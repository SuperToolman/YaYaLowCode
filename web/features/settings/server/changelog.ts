import { readFile } from "node:fs/promises";
import path from "node:path";
import { latestChangelogVersion } from "../model/changelog";

export async function loadPlatformChangelog() {
  // Next runs from web/ in development and /app/web in the deployment image.
  const markdown = await readFile(path.resolve(process.cwd(), "../CHANGELOG.md"), "utf8");
  return { markdown, version: latestChangelogVersion(markdown) };
}
