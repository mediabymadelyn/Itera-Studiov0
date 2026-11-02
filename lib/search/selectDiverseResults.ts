import { ArtworkResult } from "@/lib/types/artwork";

// Testers valued cross-referencing photos against art, so museum works keep
// at least this many slots whenever enough relevant ones exist.
const MIN_MUSEUM_RESULTS = 2;
// Slots held for results from the diversity searches (named-background and
// gender-balance Unsplash variants, Met non-Western departments), so
// they aren't crowded out by the sources' default skew.
const DIVERSITY_RESERVED_SLOTS = 4;
const DIVERSITY_MAX_PER_SOURCE = 3;
// Museum results sharing one culture/nationality ("French", "Japan") are
// capped on the first fill pass; the cap is lifted only to fill leftover
// slots, so it never shrinks the result count.
const MAX_MUSEUM_RESULTS_PER_CULTURE = 4;

export function isMuseumResult(result: ArtworkResult): boolean {
  return !result.source.toLowerCase().includes("unsplash");
}

export type SelectionOptions = {
  // Which museum results may take a reserved slot. When the query names a
  // setting or action, a museum work showing only the subject (a girl, but
  // not walking in a city) can still appear on score, but isn't guaranteed
  // a place over a photo that matches the whole request.
  isEligibleMuseum?: (result: ArtworkResult) => boolean;
};

function cultureKey(result: ArtworkResult): string | null {
  return result.culture?.trim().toLowerCase() || null;
}

/**
 * Picks the final result set from an already-ranked, already-deduped list.
 * In order: each source's single best result; enough museum results to
 * reach MIN_MUSEUM_RESULTS; a few reserved diversity-search results; then
 * the rest by score, with a soft per-culture cap on museum works. Prevents
 * a source whose metadata rarely matches query vocabulary literally (e.g.
 * Unsplash's natural-language captions vs museum titles) from being fully
 * crowded out even when it has a relevant result.
 */
export function selectWithSourceDiversity(
  rankedResults: ArtworkResult[],
  limit: number,
  options: SelectionOptions = {}
): ArtworkResult[] {
  if (rankedResults.length <= limit) {
    return rankedResults;
  }

  const selected: ArtworkResult[] = [];
  const selectedIds = new Set<string>();
  const cultureCounts = new Map<string, number>();

  function take(result: ArtworkResult) {
    selected.push(result);
    selectedIds.add(result.id);

    const culture = isMuseumResult(result) ? cultureKey(result) : null;
    if (culture) cultureCounts.set(culture, (cultureCounts.get(culture) ?? 0) + 1);
  }

  const available = () => rankedResults.filter((result) => !selectedIds.has(result.id));
  const canReserve = (result: ArtworkResult) =>
    !isMuseumResult(result) || (options.isEligibleMuseum?.(result) ?? true);

  const reservedSources = new Set<string>();
  for (const result of rankedResults) {
    if (selected.length >= limit) break;
    if (reservedSources.has(result.source) || !canReserve(result)) continue;

    reservedSources.add(result.source);
    take(result);
  }

  for (const result of available()) {
    if (selected.length >= limit) break;
    if (selected.filter(isMuseumResult).length >= MIN_MUSEUM_RESULTS) break;
    if (isMuseumResult(result) && canReserve(result)) take(result);
  }

  const diversityBySource = new Map<string, number>();
  for (const result of selected) {
    if (result.retrievedVia === "diversity") {
      diversityBySource.set(result.source, (diversityBySource.get(result.source) ?? 0) + 1);
    }
  }
  let diversityTaken = Array.from(diversityBySource.values()).reduce((a, b) => a + b, 0);

  for (const result of available()) {
    if (selected.length >= limit || diversityTaken >= DIVERSITY_RESERVED_SLOTS) break;
    if (result.retrievedVia !== "diversity") continue;

    const fromSource = diversityBySource.get(result.source) ?? 0;
    if (fromSource >= DIVERSITY_MAX_PER_SOURCE) continue;

    diversityBySource.set(result.source, fromSource + 1);
    diversityTaken++;
    take(result);
  }

  for (const result of available()) {
    if (selected.length >= limit) break;

    const culture = isMuseumResult(result) ? cultureKey(result) : null;
    if (culture && (cultureCounts.get(culture) ?? 0) >= MAX_MUSEUM_RESULTS_PER_CULTURE) continue;

    take(result);
  }

  for (const result of available()) {
    if (selected.length >= limit) break;
    take(result);
  }

  return selected.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
