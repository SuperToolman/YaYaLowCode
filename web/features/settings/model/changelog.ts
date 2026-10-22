/** Releases are ordered newest first; ignore headings inside fenced examples. */
export function latestChangelogVersion(markdown: string): string | null {
  let fence: string | null = null;
  for (const line of markdown.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const version = /^##\s+\[?v?(\d+(?:\.\d+)+(?:[a-zA-Z][\w.-]*|-[\w.-]+)?)(?=\]|\s|$)/.exec(line)?.[1];
    if (version) return version;
  }
  return null;
}
