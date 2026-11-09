import catalog from "@/lib/data/dramatic-lighting-works.json";
import { ArtworkResult } from "@/lib/types/artwork";
import { isFlatForLighting } from "@/lib/search/imageAnalysis";

// Museum catalog text almost never describes lighting. Any Met result's own
// Wikidata entry is checked for ties to dramatic light (an artist known for
// it, or a tenebrist/Caravaggist movement), so a well-lit work found by
// ordinary search ranks up. The painter and movement lists come from
// lib/data/dramatic-lighting-works.json (scripts/build-lighting-list.mts),
// which also seeds the pre-scored museum library (lib/search/museumLibrary.ts).

const PAINTER_IDS = new Set(catalog.painterIds);
const MOVEMENT_IDS = new Set(catalog.movementIds);
const KNOWN_DRAMATIC_LIGHT_BOOST = 0.25;

// --- Per-result movement signal ------------------------------------------

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const USER_AGENT = "IteraStudioArtSearch/1.0 (art reference search)";
const SIGNAL_TIMEOUT_MS = 2500;
const SIGNAL_CACHE_MAX_SIZE = 2000;
const signalCache = new Map<string, boolean>();

type Claims = Record<string, { mainsnak: { datavalue?: { value: { id?: string } } } }[]>;

function claimIds(claims: Claims | undefined, property: string): string[] {
  return (claims?.[property] ?? [])
    .map((claim) => claim.mainsnak.datavalue?.value?.id)
    .filter((id): id is string => Boolean(id));
}

/**
 * Returns the Wikidata IDs (among those given) tied to dramatic light.
 * One batched request for up to 50 uncached IDs; never throws -- on any
 * failure the signal is simply absent for this search.
 */
async function lookupDramaticLightIds(wikidataIds: string[]): Promise<Set<string>> {
  const uncached = wikidataIds.filter((id) => !signalCache.has(id)).slice(0, 50);

  if (uncached.length > 0) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SIGNAL_TIMEOUT_MS);

    try {
      const params = new URLSearchParams({
        action: "wbgetentities",
        format: "json",
        ids: uncached.join("|"),
        props: "claims"
      });
      const response = await fetch(`${WIKIDATA_API}?${params.toString()}`, {
        headers: { "User-Agent": USER_AGENT },
        signal: controller.signal,
        next: { revalidate: 604800 }
      });

      if (response.ok) {
        const data = (await response.json()) as { entities?: Record<string, { claims?: Claims }> };
        if (signalCache.size >= SIGNAL_CACHE_MAX_SIZE) signalCache.clear();

        for (const id of uncached) {
          const claims = data.entities?.[id]?.claims;
          signalCache.set(
            id,
            claimIds(claims, "P170").some((creator) => PAINTER_IDS.has(creator)) ||
              claimIds(claims, "P135").some((movement) => MOVEMENT_IDS.has(movement))
          );
        }
      }
    } catch {
      // Signal unavailable for this search; results keep their scores.
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return new Set(wikidataIds.filter((id) => signalCache.get(id)));
}

export async function lookupDramaticLightResults(results: ArtworkResult[]): Promise<Set<string>> {
  const withIds = results.filter((result) => result.wikidataId);
  const dramaticIds = await lookupDramaticLightIds(withIds.map((result) => result.wikidataId as string));

  return new Set(
    withIds
      .filter((result) => dramaticIds.has(result.wikidataId as string))
      .map((result) => result.id)
  );
}

/**
 * Marks and boosts works tied to dramatic light; lighting queries only.
 * The tie is to the artist or movement, not the painting, so a work whose
 * own image measures flat (Wright of Derby's evenly lit "Portrait of a
 * Woman") is marked but not boosted.
 */
export function applyDramaticLightSignal(
  results: ArtworkResult[],
  dramaticResultIds: Set<string>
): ArtworkResult[] {
  return results
    .map((result) => {
      const known = result.knownForDramaticLight || dramaticResultIds.has(result.id);
      if (!known) return result;

      const marked = { ...result, knownForDramaticLight: true };
      if (isFlatForLighting(marked)) return marked;

      return {
        ...marked,
        score: Number(((result.score ?? 0) + KNOWN_DRAMATIC_LIGHT_BOOST).toFixed(4))
      };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
