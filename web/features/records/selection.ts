export function mergePageSelection(selectedIds: Set<string>, pageIds: readonly string[], nextPageIds: ReadonlySet<string>): Set<string> {
  let next = selectedIds;
  for (const id of pageIds) {
    if (selectedIds.has(id) === nextPageIds.has(id)) continue;
    if (next === selectedIds) next = new Set(selectedIds);
    if (nextPageIds.has(id)) next.add(id);
    else next.delete(id);
  }
  return next;
}

export function retainAvailableSelection(selectedIds: Set<string>, availableIds: ReadonlySet<string>): Set<string> {
  const next = new Set([...selectedIds].filter((id) => availableIds.has(id)));
  return next.size === selectedIds.size ? selectedIds : next;
}
