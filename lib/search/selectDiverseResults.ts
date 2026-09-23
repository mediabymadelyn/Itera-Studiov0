import { ArtworkResult } from "@/lib/types/artwork";

/**
 * Picks the final result set from an already-ranked, already-deduped list,
 * guaranteeing each source that has at least one result gets its single
 * best-scoring result before the remaining slots are filled by score alone.
 * Prevents a source whose metadata rarely matches query vocabulary
 * literally (e.g. Unsplash's natural-language captions vs museum titles)
 * from being fully crowded out even when it has a relevant result.
 */
export function selectWithSourceDiversity(
  rankedResults: ArtworkResult[],
  limit: number
): ArtworkResult[] {
  if (rankedResults.length <= limit) {
    return rankedResults;
  }

  const selected: ArtworkResult[] = [];
  const selectedIds = new Set<string>();
  const reservedSources = new Set<string>();

  for (const result of rankedResults) {
    if (selected.length >= limit) break;
    if (reservedSources.has(result.source)) continue;

    reservedSources.add(result.source);
    selected.push(result);
    selectedIds.add(result.id);
  }

  for (const result of rankedResults) {
    if (selected.length >= limit) break;
    if (selectedIds.has(result.id)) continue;

    selected.push(result);
    selectedIds.add(result.id);
  }

  return selected.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
