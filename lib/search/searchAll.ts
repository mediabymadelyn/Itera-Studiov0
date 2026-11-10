import { searchAicArtworks } from "@/lib/sources/aic";
import { dedupeRankedResults } from "@/lib/search/dedupeResults";
import { MET_NON_WESTERN_DEPARTMENT_IDS, searchMetArtworks } from "@/lib/sources/met";
import { rankAndSelectResults } from "@/lib/search/rankResults";
import { applyVisualTagBoost } from "@/lib/search/visualTagBoost";
import { isLlmQueryLayerEnabled, selectWithLlmRerank } from "@/lib/search/llmQueryLayer";
import { planQuery, QueryPlan } from "@/lib/search/queryPlan";
import {
  genderVariant,
  hasAnyWord,
  isObjectResult,
  looksBlurry,
  pickByQuery,
  resultWords,
  underrepresentedGender
} from "@/lib/search/queryTerms";
import { isMuseumResult, limitPerArtist, selectWithSourceDiversity } from "@/lib/search/selectDiverseResults";
import { applySubjectRequirement, capObjectResults } from "@/lib/search/subjectFilter";
import { applyDramaticLightSignal, lookupDramaticLightResults } from "@/lib/search/lightingCatalog";
import { libraryResultsFor } from "@/lib/search/museumLibrary";
import {
  analyzeResultImages,
  applyImageMetrics,
  isMonochrome,
  isPixelBlurred,
  isStronglyLit
} from "@/lib/search/imageAnalysis";
import { searchUnsplashArtworks, unsplashCallsRemaining } from "@/lib/sources/unsplash";
import { routeQueryToSources, SourceName } from "@/lib/search/routeQuery";
import { ArtworkResult } from "@/lib/types/artwork";

// AIC results depend on Wikidata (see wikidataAicImages.ts), an external
// service we don't control. Bounding this branch to a short budget and
// cancelling it on timeout means a slow/down Wikidata can only ever cost
// AIC's own results for that search -- never stall Met/Unsplash, which
// resolve independently via Promise.allSettled below.
const AIC_BRANCH_TIMEOUT_MS = 2500;

// How many top-ranked candidates the LLM rerank layer gets to choose from.
// Used to be capped at 18 because a single monolithic selection call got
// slower and less reliable as the pool grew. Now that selection is split
// into small parallel relevance-only chunks (see llmQueryLayer.ts), that
// constraint doesn't apply the same way -- 28 lines up with each source's
// own raw-fetch ceiling (18 each, so 3 sources can realistically supply
// this many after dedupe) and gives real headroom for an 18-result final
// list with genuine variety, not just padding.
const LLM_RERANK_CANDIDATE_POOL_SIZE = 28;
// Extra pool seats beyond the top-scored 28, so museum and diversity-search
// candidates still reach the LLM even when photos dominate the scores --
// otherwise the reserved slots in selectWithSourceDiversity would have
// nothing approved to fill them with.
// Museum works rank low on keywords (their titles rarely repeat the
// search's words), so more of them get a vision check: at 4, Pissarro's
// "Young Peasant Having Her Coffee" (a full match for "hands holding coffee
// cup") only made the pool on some runs.
const POOL_EXTRA_MUSEUM = 8;
const POOL_EXTRA_DIVERSITY = 4;

// Secondary Met searches fetch fewer objects: each one is its own request.
const MET_SECONDARY_OBJECT_LIMIT = 4;

// Compound requests ("hedgehog doing a backflip") rarely have results
// showing both parts. Rather than letting either half vanish, the final set
// keeps at least this many results for each part when candidates exist.
const MIN_RESULTS_PER_QUERY_PART = 3;

// Below this many LLM-approved results the page is topped up with the
// next-best candidates (see selectWithLlmRerank).
const MIN_RESULTS = 12;

// The page is one list in two sections (see arrangeSections): "Best
// matches" first, then "More results" below a divider.
const BEST_MATCHES_MAX = 12;
// Museum works that qualify for Best matches keep at least this many of its
// places (spread through it, not bunched at the end): cross-referencing art
// against photos is what testers valued most.
const BEST_MIN_MUSEUM = 3;
// Every this-many places, one reserved museum work (places 2, 5, 8).
const BEST_MUSEUM_SPACING = 3;

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
  // Bypasses query planning (see queryPlan.ts): sends the raw query to
  // source APIs unmodified instead of a short, translated keyword version.
  // Use this for keyword-only baseline benchmarks -- with it left on (the
  // default), source-API queries are already a translated/filtered version
  // of what the user typed, not a pure keyword pass-through.
  disableQueryTranslation?: boolean;
  // The actual LLM query-translation arm (see llmQueryLayer.ts): an LLM
  // rewrites long queries before retrieval (queryPlan.ts) and makes the
  // final call on which retrieved candidates actually get shown. Defaults
  // to ENABLE_LLM_QUERY_LAYER when not explicitly passed. Falls back to the
  // word-based plan and the normal mechanical selection
  // (selectWithSourceDiversity) on any failure -- never breaks search.
  enableLlmRerank?: boolean;
};

type Tagged = { label: string; promise: Promise<ArtworkResult[]> };

function tagRetrieval(
  results: ArtworkResult[],
  retrievedVia: ArtworkResult["retrievedVia"]
): ArtworkResult[] {
  return results.map((result) => ({ ...result, retrievedVia }));
}

// The Met's search requires every word to match, so narrower queries come
// first and the chain falls back toward just the subject until one hits.
async function firstNonEmpty(
  queries: string[],
  search: (query: string) => Promise<ArtworkResult[]>
): Promise<ArtworkResult[]> {
  for (const query of queries) {
    const results = await search(query);
    if (results.length > 0) return results;
  }

  return [];
}

function buildSourceSearches(
  source: SourceName,
  plan: QueryPlan,
  limit: number
): Tagged[] {
  if (source === "met") {
    const searches: Tagged[] = [
      {
        label: "met",
        promise: firstNonEmpty(plan.museumQueries, (q) => searchMetArtworks(q, limit)).then(
          (results) => tagRetrieval(results, "primary")
        )
      }
    ];

    for (const secondary of plan.museumSecondarySearches) {
      searches.push({
        label: `met (secondary${secondary.departmentId ? `, department ${secondary.departmentId}` : ""})`,
        promise: firstNonEmpty(secondary.queries, (q) =>
          searchMetArtworks(q, limit, {
            objectLimit: MET_SECONDARY_OBJECT_LIMIT,
            departmentId: secondary.departmentId
          })
        ).then((results) => tagRetrieval(results, "secondary"))
      });
    }

    searches.push({
      label: "met (department)",
      promise: searchMetArtworks(plan.subject, limit, {
        departmentId: pickByQuery(plan.original, MET_NON_WESTERN_DEPARTMENT_IDS),
        objectLimit: MET_SECONDARY_OBJECT_LIMIT
      }).then((results) => tagRetrieval(results, "diversity"))
    });

    return searches;
  }

  if (source === "aic") {
    const controller = new AbortController();
    const aicQuery = [plan.keywordQuery, plan.aicSubjectTerm, plan.lighting?.aicTerm].filter(Boolean).join(" ");
    const aicPromise = searchAicArtworks(aicQuery, limit, controller.signal);

    return [
      {
        label: "aic",
        promise: withTimeout(aicPromise, AIC_BRANCH_TIMEOUT_MS, controller, []).then(
          (results) => tagRetrieval(results, "primary")
        )
      }
    ];
  }

  const primary = searchUnsplashArtworks(plan.photoQuery, limit);
  const searches: Tagged[] = [
    { label: "unsplash", promise: primary.then((results) => tagRetrieval(results, "primary")) }
  ];
  let budget = unsplashExtraSearchBudget();

  if (plan.photoSecondaryQuery && budget > 0) {
    budget--;
    searches.push({
      label: "unsplash (secondary)",
      promise: searchUnsplashArtworks(plan.photoSecondaryQuery, limit).then((results) =>
        tagRetrieval(results, "secondary")
      )
    });
  }

  // Lighting-pattern searches come next, but leave room for the diversity
  // variants and gender balancing below.
  const diversityReserve =
    Math.min(plan.photoBackgroundQueries.length, MAX_BACKGROUND_SEARCHES) + (plan.balanceGender ? 1 : 0);
  for (const patternQuery of plan.photoLightingQueries) {
    if (budget <= diversityReserve) break;
    budget--;
    searches.push({
      label: `unsplash (lighting: ${patternQuery})`,
      promise: searchUnsplashArtworks(patternQuery, limit).then((results) =>
        tagRetrieval(results, "primary")
      )
    });
  }

  // One slot is held back for gender balancing when it could apply; the
  // rest go to named-background variants, all run in parallel.
  const backgroundCount = Math.max(0, budget - (plan.balanceGender && budget > 1 ? 1 : 0));
  for (const variant of plan.photoBackgroundQueries.slice(0, backgroundCount)) {
    budget--;
    searches.push({
      label: `unsplash (diversity: ${variant})`,
      // When the user named the background these searches are the request
      // itself ("Black woman dancing" for "black dancer"), so they compete as
      // main results instead of for the few diversity places.
      promise: searchUnsplashArtworks(variant, limit).then((results) =>
        tagRetrieval(results, plan.statedBackground ? "primary" : "diversity")
      )
    });
  }

  // Gender balancing waits for the first results (adds one Unsplash round
  // trip, ~0.3-0.6s) and only spends a call when their captions clearly
  // skew one way -- P4 saw only women for "dancer".
  if (plan.balanceGender && budget > 0) {
    searches.push({
      label: "unsplash (gender balance)",
      promise: primary
        .then((results) => {
          const missing = underrepresentedGender(results);
          return missing
            ? searchUnsplashArtworks(genderVariant(plan.photoQuery, missing, plan.bodyPartSubject), limit)
            : [];
        })
        .then((results) => tagRetrieval(results, "diversity"))
    });
  }

  return searches;
}

// Extra Unsplash searches allowed per user search, on top of the primary
// one. Defaults to 3; spends less as the hourly quota runs low (the demo
// tier allows only 50 calls/hour), so variants never starve the primary
// search for the next user.
// With the production Unsplash key (1000 requests an hour) a lighting
// search can afford 4 pattern searches + 2 diversity variants + gender
// balancing: 8 calls in all, ~125 searches an hour.
const DEFAULT_UNSPLASH_EXTRA_SEARCHES = 7;
const MAX_BACKGROUND_SEARCHES = 2;

function unsplashExtraSearchBudget(): number {
  const configured = Number(process.env.UNSPLASH_MAX_EXTRA_SEARCHES);
  const max = Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_UNSPLASH_EXTRA_SEARCHES;
  const remaining = unsplashCallsRemaining();

  if (remaining === null) return max;
  if (remaining < 10) return 0;
  if (remaining < 25) return Math.min(max, 1);
  return max;
}

async function fetchCandidates(plan: QueryPlan, limit: number): Promise<ArtworkResult[]> {
  const searches = routeQueryToSources(plan.original).flatMap((source) =>
    buildSourceSearches(source, plan, limit)
  );

  // Museum works known for dramatic light, pre-scored (see
  // museumLibrary.ts) -- the museums' own search can't find them by lighting.
  if (plan.lighting?.kind === "dramatic") {
    searches.push({ label: "museum library", promise: Promise.resolve(libraryResultsFor(plan)) });
  }

  const settledResults = await Promise.allSettled(searches.map((search) => search.promise));

  // A failed source is dropped so the others still return, but log it --
  // otherwise a broken upstream API just silently disappears from results.
  settledResults.forEach((result, index) => {
    if (result.status === "rejected") {
      console.warn(`[search] ${searches[index].label} source failed:`, result.reason);
    }
  });

  return settledResults.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []
  );
}

function subjectOnly(plan: QueryPlan): QueryPlan {
  return {
    ...plan,
    museumQueries: [plan.subject],
    museumSecondarySearches: [],
    keywordQuery: plan.subject,
    photoQuery: plan.subject,
    photoSecondaryQuery: undefined
  };
}

function ensureCompoundCoverage(
  finalResults: ArtworkResult[],
  candidates: ArtworkResult[],
  plan: QueryPlan,
  limit: number
): ArtworkResult[] {
  if (plan.actionWords.length === 0 || plan.subjectWords.length === 0) {
    return finalResults;
  }

  const showsSubject = (result: ArtworkResult) =>
    hasAnyWord(resultWords(result), plan.subjectWords);
  const showsAction = (result: ArtworkResult) =>
    hasAnyWord(resultWords(result), plan.actionWords);
  const selected = [...finalResults];

  for (const [showsPart, showsOtherPart] of [
    [showsSubject, showsAction],
    [showsAction, showsSubject]
  ]) {
    let missing = MIN_RESULTS_PER_QUERY_PART - selected.filter(showsPart).length;

    for (const candidate of candidates) {
      if (missing <= 0) break;
      if (selected.some((result) => result.id === candidate.id) || !showsPart(candidate)) continue;

      if (selected.length >= limit) {
        // Make room by dropping the lowest-scored result that doesn't show
        // this part, as long as that doesn't push the other part below its
        // own minimum.
        const otherPartCount = selected.filter(showsOtherPart).length;
        const removable = selected
          .filter(
            (result) =>
              !showsPart(result) &&
              (!showsOtherPart(result) || otherPartCount > MIN_RESULTS_PER_QUERY_PART)
          )
          .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))[0];
        if (!removable) break;
        selected.splice(selected.indexOf(removable), 1);
      }

      selected.push(candidate);
      missing--;
    }
  }

  return selected.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

function matchesWholeRequest(result: ArtworkResult, plan: QueryPlan): boolean {
  const words = resultWords(result);

  return (
    (plan.actionWords.length === 0 || hasAnyWord(words, plan.actionWords)) &&
    (plan.settingWords.length === 0 || hasAnyWord(words, plan.settingWords))
  );
}

/**
 * Best matches need: the vision check's full match (2/2: every part of the
 * request, from the image itself -- captions get it wrong both ways),
 * strong lighting on lighting searches (testers rejected every evenly lit
 * pick for "dramatic lighting", 6/6), and not a 3D object or blurred unless
 * asked for. Unjudged results (the model timed out) never qualify.
 */
function qualifiesForBest(result: ArtworkResult, plan: QueryPlan): boolean {
  return (
    result.visionMatch === 2 &&
    (!plan.lighting || isStronglyLit(result)) &&
    (plan.allowsObjects || !isObjectResult(result)) &&
    (plan.allowsBlur || (!looksBlurry(result) && !isPixelBlurred(result)))
  );
}

/**
 * Splits the ranked results into Best matches and More results, keeping one
 * page (nothing hides behind a filter any more). Best matches: up to
 * BEST_MATCHES_MAX qualifying results, at least BEST_MIN_MUSEUM of them
 * museum works when that many qualify, and at most half black-and-white
 * unless the search asked for it ("dramatic lighting on face" was all
 * black-and-white studio portraits). Never filled with weak results: a
 * short Best section is better than a padded one. Without the vision check
 * nothing says which results match the whole request, so all are "best".
 */
function arrangeSections(results: ArtworkResult[], plan: QueryPlan): ArtworkResult[] {
  if (!results.some((result) => result.visionMatch !== undefined)) {
    return results.map((result) => ({ ...result, section: "best" as const }));
  }

  const qualifying = results.filter((result) => qualifiesForBest(result, plan));
  const monochromeCap = plan.wantsMonochrome ? BEST_MATCHES_MAX : Math.floor(BEST_MATCHES_MAX / 2);
  const best: ArtworkResult[] = [];
  let monochrome = 0;
  // One per named artist in Best: two shots from one shoot side by side
  // read as duplicates ("dynamic pose"). The second goes to More results.
  const bestArtists = new Set<string>();
  const artistOf = (result: ArtworkResult) => {
    const name = result.artist.trim().toLowerCase();
    return name.startsWith("unknown") || name === "anonymous" ? null : name;
  };
  const take = (result: ArtworkResult): boolean => {
    if (best.length >= BEST_MATCHES_MAX || best.includes(result)) return false;
    const artist = artistOf(result);
    if (artist && bestArtists.has(artist)) return false;
    if (isMonochrome(result)) {
      if (monochrome >= monochromeCap) return false;
      monochrome++;
    }
    best.push(result);
    if (artist) bestArtists.add(artist);
    return true;
  };

  const reserved: ArtworkResult[] = [];
  for (const result of qualifying) {
    if (reserved.length >= BEST_MIN_MUSEUM) break;
    if (isMuseumResult(result) && take(result)) reserved.push(result);
  }
  for (const result of qualifying) take(result);

  // Ranked order, except each reserved museum work moves up to its spread
  // place (2, 5, 8) if it ranked lower than that.
  const rank = new Map(results.map((result, index) => [result.id, index]));
  const ordered = best
    .filter((result) => !reserved.includes(result))
    .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  reserved.forEach((result, k) => {
    const natural = ordered.findIndex((other) => rank.get(other.id)! > rank.get(result.id)!);
    const target = 1 + k * BEST_MUSEUM_SPACING;
    ordered.splice(Math.min(natural === -1 ? ordered.length : natural, target, ordered.length), 0, result);
  });

  const bestIds = new Set(ordered.map((result) => result.id));
  return [
    ...ordered.map((result) => ({ ...result, section: "best" as const })),
    ...results.filter((result) => !bestIds.has(result.id)).map((result) => ({ ...result, section: "more" as const }))
  ];
}

// Sculpture and other 3D objects stay when relevant (a marble hand can be a
// good hand reference) but testers didn't want them leading the page
// ("too many statue results"), so they go to the end of the grid unless
// the query asked for objects.
function objectsLast(results: ArtworkResult[], plan: QueryPlan): ArtworkResult[] {
  if (plan.allowsObjects) return results;
  return [...results.filter((result) => !isObjectResult(result)), ...results.filter(isObjectResult)];
}

function buildRerankPool(candidates: ArtworkResult[]): ArtworkResult[] {
  const pool = candidates.slice(0, LLM_RERANK_CANDIDATE_POOL_SIZE);
  const rest = candidates.slice(LLM_RERANK_CANDIDATE_POOL_SIZE);

  const extraMuseum = rest.filter(isMuseumResult).slice(0, POOL_EXTRA_MUSEUM);
  const extraDiversity = rest
    .filter((result) => result.retrievedVia === "diversity" && !extraMuseum.includes(result))
    .slice(0, POOL_EXTRA_DIVERSITY);

  return [...pool, ...extraMuseum, ...extraDiversity];
}

export async function searchAllArtworks(
  query: string,
  limit = 6,
  options: SearchAllArtworksOptions = {}
): Promise<ArtworkResult[]> {
  const startedAt = Date.now();
  const useLlmRerank = options.enableLlmRerank ?? isLlmQueryLayerEnabled();
  const plan = await planQuery(query, {
    passthrough: options.disableQueryTranslation,
    allowLlmRewrite: useLlmRerank
  });

  const plannedAt = Date.now();
  let combined = await fetchCandidates(plan, limit);

  // Last resort for very specific requests: nothing matched anywhere, so
  // retry with just the subject rather than showing an empty page.
  if (combined.length === 0 && plan.keywordQuery !== plan.subject) {
    combined = await fetchCandidates(subjectOnly(plan), limit);
  }

  const ranked = rankAndSelectResults(combined, plan, combined.length);
  const required = applySubjectRequirement(ranked, plan);
  const deduped = capObjectResults(dedupeRankedResults(required), plan);
  const fetchedAt = Date.now();

  // Lighting searches only give a reserved diversity slot to a strongly
  // lit result; others can still place on score.
  const isEligibleDiversity = plan.lighting ? isStronglyLit : undefined;
  const selection = {
    isEligibleMuseum: (result: ArtworkResult) => matchesWholeRequest(result, plan),
    isEligibleDiversity
  };

  // Pixel checks (contrast for lighting queries, blur for photos) and, for
  // lighting queries, the Wikidata movement lookup start now and run
  // alongside the LLM relevance calls, so they add no wait of their own;
  // their scores are folded in before the final pick.
  const pool = buildRerankPool(deduped);
  const metricsPromise = analyzeResultImages(pool);
  const signalPromise = plan.lighting
    ? lookupDramaticLightResults(pool)
    : Promise.resolve(new Set<string>());
  const withImageScores = async (results: ArtworkResult[]) => {
    const [metrics, dramaticIds] = await Promise.all([metricsPromise, signalPromise]);
    const measured = applyImageMetrics(results, metrics, {
      lighting: Boolean(plan.lighting),
      allowsBlur: plan.allowsBlur
    });
    return plan.lighting ? applyDramaticLightSignal(measured, dramaticIds) : measured;
  };

  const rerank = useLlmRerank
    ? await selectWithLlmRerank(pool, query, limit, {
        selection,
        // A sculpture the vision model judged relevant can still appear on
        // score, but doesn't take a guaranteed museum slot unless objects
        // were asked for.
        visionSelection: {
          isEligibleMuseum: (result) => plan.allowsObjects || !isObjectResult(result),
          isEligibleDiversity
        },
        minResults: MIN_RESULTS,
        adjustScores: withImageScores
      })
    : null;
  const llmResults = rerank?.results ?? null;

  // The rerank adds a few approved extras after its selection, so coverage
  // may use the whole list rather than trimming back to the limit.
  const selected =
    llmResults ?? selectWithSourceDiversity(await withImageScores(deduped), limit, selection);
  const covered = ensureCompoundCoverage(
    selected,
    deduped.filter((result) => !rerank?.rejectedIds.has(result.id)),
    plan,
    Math.max(limit, selected.length)
  );
  // The per-artist cap runs once more over everything shown (coverage adds
  // results after selection); earlier results keep their places.
  const finalResults = limitPerArtist(objectsLast(covered, plan));

  const selectedAt = Date.now();

  // Experimental, opt-in (ENABLE_VISUAL_SEARCH): re-orders this final set
  // using lighting/mood/composition tags. See lib/search/visualTagBoost.ts
  // and docs/blip-caption-eval.md.
  const boosted = arrangeSections(await applyVisualTagBoost(finalResults, query), plan);

  // Opt-in per-stage timing, for deciding where speed work is worth it.
  if (process.env.SEARCH_TIMING_LOG === "true") {
    console.info(
      `[search timing] "${query}" plan=${plannedAt - startedAt}ms` +
        `${plan.rewrittenByLlm ? " (llm rewrite)" : ""} sources=${fetchedAt - plannedAt}ms` +
        ` llm-select+labels=${selectedAt - fetchedAt}ms visual=${Date.now() - selectedAt}ms` +
        ` total=${Date.now() - startedAt}ms candidates=${deduped.length} results=${boosted.length}`
    );
  }

  return boosted;
}
