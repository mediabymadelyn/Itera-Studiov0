import { searchAicArtworks } from "@/lib/sources/aic";
import { dedupeRankedResults } from "@/lib/search/dedupeResults";
import { searchMetArtworks } from "@/lib/sources/met";
import { rankAndSelectResults } from "@/lib/search/rankResults";
import { applyVisualTagBoost, extractSubjectQuery } from "@/lib/search/visualTagBoost";
import { isLlmQueryLayerEnabled, selectWithLlmRerank } from "@/lib/search/llmQueryLayer";
import { selectWithSourceDiversity } from "@/lib/search/selectDiverseResults";
import { searchUnsplashArtworks } from "@/lib/sources/unsplash";
import { routeQueryToSources, SourceName } from "@/lib/search/routeQuery";
import { ArtworkResult } from "@/lib/types/artwork";

// AIC results depend on Wikidata (see wikidataAicImages.ts), an external
// service we don't control. Bounding this branch to a short budget and
// cancelling it on timeout means a slow/down Wikidata can only ever cost
// AIC's own results for that search -- never stall Met/Unsplash, which
// resolve independently via Promise.allSettled below.
const AIC_BRANCH_TIMEOUT_MS = 2500;

// How many top-ranked candidates the LLM rerank layer gets to choose from --
// capped for latency/cost, not the full pool.
const LLM_RERANK_CANDIDATE_POOL_SIZE = 15;

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  controller: AbortController,
  fallback: T
): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      controller.abort();
      resolve(fallback);
    }, ms);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

export type SearchAllArtworksOptions = {
  // Bypasses extractSubjectQuery() (see visualTagBoost.ts): sends the raw
  // query to source APIs unmodified instead of stripping recognized
  // lighting/composition descriptor phrases first. Use this for
  // keyword-only baseline benchmarks -- with it left on (the default),
  // source-API queries are already a translated/filtered version of what
  // the user typed, not a pure keyword pass-through.
  disableQueryTranslation?: boolean;
  // The actual LLM query-translation arm (see llmQueryLayer.ts): retrieval
  // stays plain keyword search, but an LLM makes the final call on which
  // retrieved candidates actually get shown, using the original query text
  // plus each candidate's metadata. Defaults to ENABLE_LLM_QUERY_LAYER when
  // not explicitly passed. Falls back to the normal mechanical selection
  // (selectWithSourceDiversity) on any failure -- never breaks search.
  enableLlmRerank?: boolean;
};

export async function searchAllArtworks(
  query: string,
  limit = 6,
  options: SearchAllArtworksOptions = {}
): Promise<ArtworkResult[]> {
  const routedSources = routeQueryToSources(query);
  const subjectQuery = options.disableQueryTranslation
    ? query
    : extractSubjectQuery(query);

  function runSourceSearch(source: SourceName): Promise<ArtworkResult[]> {
    if (source === "met") return searchMetArtworks(subjectQuery, limit);

    if (source === "aic") {
      const controller = new AbortController();
      const aicPromise = searchAicArtworks(subjectQuery, limit, controller.signal);
      return withTimeout(aicPromise, AIC_BRANCH_TIMEOUT_MS, controller, []);
    }

    return searchUnsplashArtworks(subjectQuery, limit);
  }

  const settledResults = await Promise.allSettled(
    routedSources.map((source) => runSourceSearch(source))
  );

  const combined = settledResults.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []
  );

  const ranked = rankAndSelectResults(
    combined,
    query,
    Math.max(combined.length, limit)
  );

  const deduped = dedupeRankedResults(ranked);

  const useLlmRerank = options.enableLlmRerank ?? isLlmQueryLayerEnabled();
  const llmResults = useLlmRerank
    ? await selectWithLlmRerank(
        deduped.slice(0, LLM_RERANK_CANDIDATE_POOL_SIZE),
        query,
        limit
      )
    : null;

  const finalResults = llmResults ?? selectWithSourceDiversity(deduped, limit);

  // Experimental, opt-in (ENABLE_VISUAL_SEARCH): re-orders this final set
  // using lighting/mood/composition tags. See lib/search/visualTagBoost.ts
  // and docs/blip-caption-eval.md.
  return applyVisualTagBoost(finalResults, query);
}
