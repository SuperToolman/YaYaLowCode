/** Flatten merged evidence while accepting historical tool results. */
export function evidenceSources(items: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  return items.flatMap((item: Record<string, unknown>) => {
    if (!item || typeof item !== "object") return [];
    const sources = Array.isArray(item.sources) && item.sources.length ? item.sources : [item];
    return sources.filter((source): source is Record<string, unknown> => {
      if (!source || typeof source !== "object") return false;
      const id = source.citationId;
      if (typeof id !== "string" || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  });
}
