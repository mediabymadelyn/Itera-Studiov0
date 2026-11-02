import catalog from "@/lib/data/dramatic-lighting-works.json";
import { ArtworkResult } from "@/lib/types/artwork";
import { QueryPlan } from "@/lib/search/queryPlan";
import { fetchMetObjects } from "@/lib/sources/met";
import { fetchAicArtworksByIds } from "@/lib/sources/aic";
import { isFlatForLighting } from "@/lib/search/imageAnalysis";
import {
  hasAnyWord,
  isPeopleQuery,
  pickByQuery,
  subjectSynonyms,
  tokenize
} from "@/lib/search/queryTerms";

// Museum catalog text almost never describes lighting, and the Met's own
// lighting searches returned evenly lit self-portraits. Two Wikidata-based
// signals fill that gap without a model:
//   1. A curated list of paintings in the Met/AIC tied to dramatic light
//      (built offline by scripts/build-lighting-list.mts) supplies museum
//      results for "dramatic lighting" queries directly.
//   2. Any Met result's own Wikidata entry is checked for the same ties
//      (artist known for dramatic light, or a tenebrist/Caravaggist
//      movement), so a well-lit work found by ordinary search ranks up too.

type CuratedWork = {
  source: "met" | "aic";
  objectId: string;
  wikidataId: string;
  title: string;
  artist: string;
  genres: string[];
  depicts: string[];
  image?: string;
  reason: string;
};

const works = catalog.works as CuratedWork[];
const PAINTER_IDS = new Set(catalog.painterIds);
const MOVEMENT_IDS = new Set(catalog.movementIds);

const CURATED_RESULTS_PER_SEARCH = 6;
// Rembrandt alone is ~45% of the list; without a cap one search could be
// six Rembrandts.
const MAX_CURATED_PER_ARTIST = 2;
const KNOWN_DRAMATIC_LIGHT_BOOST = 0.25;

// Depictions that make a work usable for a person-shaped subject ("face",
// "profile", "dancer") even when its title doesn't name it.
const PERSON_DEPICTIONS = ["human", "man", "woman", "person", "boy", "girl", "child", "portrait", "saint", "musician", "figure"];

function matchesSubject(work: CuratedWork, plan: QueryPlan): boolean {
  const head = plan.subjectWords[plan.subjectWords.length - 1];
  if (!head) return true;

  const words = new Set(tokenize([work.title, ...work.genres, ...work.depicts].join(" ")));
  if (hasAnyWord(words, [head, ...subjectSynonyms(head)])) return true;

  return isPeopleQuery(plan.subjectWords) && hasAnyWord(words, PERSON_DEPICTIONS);
}

/**
 * Up to CURATED_RESULTS_PER_SEARCH works from the curated list that fit the
 * query's subject. The starting point rotates by query, so different
 * searches surface different works rather than the same six every time.
 */
function curatedWorksFor(plan: QueryPlan): CuratedWork[] {
  const matching = works.filter((work) => matchesSubject(work, plan));
  if (matching.length === 0) return [];

  const start = matching.indexOf(pickByQuery(plan.original, matching));
  const chosen: CuratedWork[] = [];
  const perArtist = new Map<string, number>();

  for (let offset = 0; offset < matching.length && chosen.length < CURATED_RESULTS_PER_SEARCH; offset++) {
    const work = matching[(start + offset) % matching.length];
    const count = perArtist.get(work.artist) ?? 0;
    if (count >= MAX_CURATED_PER_ARTIST) continue;

    perArtist.set(work.artist, count + 1);
    chosen.push(work);
  }

  return chosen;
}

export async function fetchCuratedLightingResults(plan: QueryPlan): Promise<ArtworkResult[]> {
  const chosen = curatedWorksFor(plan);
  const byKey = new Map(chosen.map((work) => [`${work.source}-${work.objectId}`, work]));

  const metIds = chosen.filter((work) => work.source === "met").map((work) => Number(work.objectId));
  const aicImages = new Map(
    chosen
      .filter((work) => work.source === "aic" && work.image)
      .map((work) => [work.objectId, work.image as string])
  );

  const [met, aic] = await Promise.all([fetchMetObjects(metIds), fetchAicArtworksByIds(aicImages)]);

  // Genre and depictions go into the result's tags so the subject check and
  // the LLM relevance step can see what the painting shows.
  return [...met, ...aic].map((result) => {
    const work = byKey.get(result.id);
    return {
      ...result,
      tags: [...(result.tags ?? []), ...(work?.genres ?? []), ...(work?.depicts ?? [])],
      knownForDramaticLight: true,
      retrievedVia: "secondary" as const
    };
  });
}

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
