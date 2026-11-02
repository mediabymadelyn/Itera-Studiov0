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
import { isMuseumResult, selectWithSourceDiversity } from "@/lib/search/selectDiverseResults";
import { applySubjectRequirement, capObjectResults } from "@/lib/search/subjectFilter";
import {
  applyDramaticLightSignal,
  fetchCuratedLightingResults,
  lookupDramaticLightResults
} from "@/lib/search/lightingCatalog";
import {
  analyzeResultImages,
  applyImageMetrics,
  isDramaticallyLit,
  isFlatForLighting,
  isPixelBlurred,
  isStronglyLit
} from "@/lib/search/imageAnalysis";
import { searchUnsplashArtworks, unsplashCallsRemaining } from "@/lib/sources/unsplash";
import { routeQueryToSources, SourceName } from "@/lib/search/routeQuery";
import { MATCH_REASON_CATEGORIES, MatchReasonCategory } from "@/lib/search/categories";
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
const POOL_EXTRA_MUSEUM = 4;
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

// Lighting searches: evenly lit results (see isFlatForLighting) move off
// the main grid into the category filters. (Promoting lit bench picks into
// their place was tried: pixels alone promoted woven bags titled "Bag
// Face" for "dramatic lighting on face".) The grid never shrinks below
// this, so a search with few lit candidates keeps its best flat ones at
// the end instead of going sparse.
const MIN_LIGHTING_MAIN_RESULTS = 8;

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
    const aicQuery = plan.lighting
      ? `${plan.keywordQuery} ${plan.lighting.aicTerm}`
      : plan.keywordQuery;
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

  // One slot is held back for gender balancing when it could apply; the
  // rest go to named-background variants, all run in parallel.
  const backgroundCount = Math.max(0, budget - (plan.balanceGender && budget > 1 ? 1 : 0));
  for (const variant of plan.photoBackgroundQueries.slice(0, backgroundCount)) {
    budget--;
    searches.push({
      label: `unsplash (diversity: ${variant})`,
      promise: searchUnsplashArtworks(variant, limit).then((results) =>
        tagRetrieval(results, "diversity")
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
const DEFAULT_UNSPLASH_EXTRA_SEARCHES = 3;

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

  // Museum works known for dramatic light (see lightingCatalog.ts) -- the
  // museums' own search can't find them by lighting.
  if (plan.lighting?.kind === "dramatic") {
    searches.push({ label: "curated lighting list", promise: fetchCuratedLightingResults(plan) });
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
 * The top pick has to be a result that meets every part of the request --
 * action and setting when given, strong lighting for lighting queries (by
 * the vision check or the pixel drama measure; testers rejected every
 * evenly lit top pick for "dramatic lighting", 6/6, and an artist known for
 * dramatic light doesn't make every one of their works lit), not blurred
 * (by caption or pixels) and not a 3D object unless those were asked for. When nothing
 * qualifies there is no top pick: a confident-looking badge on a weak
 * match did more harm in testing than no badge at all.
 */
// When the vision model judged a result, its read of the image decides
// "the whole request" -- captions get it wrong both ways ("woman running"
// passed for "girl walking in city"; Tanoura dancers were captioned
// "spinning wheels"). Unjudged results fall back to the caption words.
function meetsWholeRequest(result: ArtworkResult, plan: QueryPlan): boolean {
  if (result.visionMatch !== undefined) return result.visionMatch === 2;
  return matchesWholeRequest(result, plan);
}

function chooseTopPick(results: ArtworkResult[], plan: QueryPlan): ArtworkResult[] {
  const pick = results.find(
    (result) =>
      meetsWholeRequest(result, plan) &&
      (plan.allowsObjects || !isObjectResult(result)) &&
      (plan.allowsBlur || (!looksBlurry(result) && !isPixelBlurred(result))) &&
      (!plan.lighting || isStronglyLit(result))
  );

  if (!pick) return results;

  return [{ ...pick, isTopPick: true }, ...results.filter((result) => result.id !== pick.id)];
}

// Sculpture and other 3D objects stay when relevant (a marble hand can be a
// good hand reference) but testers didn't want them leading the page
// ("too many statue results"), so they go to the end of the grid unless
// the query asked for objects.
function objectsLast(results: ArtworkResult[], plan: QueryPlan): ArtworkResult[] {
  if (plan.allowsObjects) return results;
  return [...results.filter((result) => !isObjectResult(result)), ...results.filter(isObjectResult)];
}

function demoteFlatLighting(
  main: ArtworkResult[],
  bench: ArtworkResult[],
  plan: QueryPlan
): { main: ArtworkResult[]; bench: ArtworkResult[] } {
  if (!plan.lighting) return { main, bench };

  const flat = main.filter(isFlatForLighting);
  if (flat.length === 0) return { main, bench };

  const kept = main.filter((result) => !isFlatForLighting(result));
  const flatKept = Math.max(0, MIN_LIGHTING_MAIN_RESULTS - kept.length);

  return {
    main: [...kept, ...flat.slice(0, flatKept)],
    bench: [...bench, ...flat.slice(flatKept).map((result) => ({ ...result, benchOnly: true }))]
  };
}

// When a category is still empty after labeling and the bench step (e.g.
// "side profile dramatic lighting" had nothing for Environment or Color
// Palette -- the matching photos were all studio shots on black), one
// targeted photo search per empty category finds real material for it.
// Results are subject-checked like any other, labeled with that category,
// and shown only under its filter. Historical/Cultural Reference has no
// photo equivalent, so it relies on the museum results and bench step.
const CATEGORY_SEARCH_MODIFIERS: Partial<Record<MatchReasonCategory, string>> = {
  "Environment/Setting": "outdoors",
  "Color Palette": "colorful",
  Composition: "minimal",
  "Texture/Material": "texture close up",
  "Expression/Emotion": "expressive",
  "Pose/Anatomy": "pose",
  "Style/Technique": "film photography",
  Lighting: "dramatic lighting"
};
const MAX_CATEGORY_SEARCHES = 3;
const RESULTS_PER_FILLED_CATEGORY = 2;

async function fillEmptyCategories(
  results: ArtworkResult[],
  plan: QueryPlan,
  limit: number
): Promise<ArtworkResult[]> {
  const covered = new Set(results.flatMap((result) => result.matchReasons ?? []));
  const shownIds = new Set(results.map((result) => result.id));
  const budget = Math.min(MAX_CATEGORY_SEARCHES, unsplashExtraSearchBudget());

  const targets = MATCH_REASON_CATEGORIES.filter(
    (category) =>
      !covered.has(category) &&
      CATEGORY_SEARCH_MODIFIERS[category] &&
      // A stated setting already is the environment the user asked for.
      !(category === "Environment/Setting" && plan.settingWords.length > 0)
  ).slice(0, budget);

  const filled = await Promise.all(
    targets.map(async (category) => {
      try {
        const found = await searchUnsplashArtworks(
          `${plan.photoQuery} ${CATEGORY_SEARCH_MODIFIERS[category]}`,
          limit
        );
        let candidates = applySubjectRequirement(
          rankAndSelectResults(tagRetrieval(found, "secondary"), plan, found.length),
          plan,
          { strict: true }
        ).filter((result) => !shownIds.has(result.id));

        // A Lighting fill has to actually look dramatically lit.
        if (category === "Lighting") {
          const metrics = await analyzeResultImages(candidates);
          candidates = applyImageMetrics(candidates, metrics, {
            lighting: true,
            allowsBlur: plan.allowsBlur
          }).filter(isDramaticallyLit);
        }
        candidates = candidates.filter((result) => isUsableExtra(result, plan));

        return candidates.slice(0, RESULTS_PER_FILLED_CATEGORY).map((result) => ({
          ...result,
          matchReasons: [category],
          benchOnly: true
        }));
      } catch (error) {
        console.warn(`[search] category fill for ${category} failed:`, error);
        return [];
      }
    })
  );

  const seen = new Set<string>();
  return filled.flat().filter((result) => !seen.has(result.id) && seen.add(result.id));
}

// Extras (bench and category fills) are judged on less evidence than the
// main page, so blurred ones are dropped outright rather than ranked lower.
function isUsableExtra(result: ArtworkResult, plan: QueryPlan): boolean {
  return plan.allowsBlur || (!looksBlurry(result) && !isPixelBlurred(result));
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

  const selection = {
    isEligibleMuseum: (result: ArtworkResult) => matchesWholeRequest(result, plan)
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
          isEligibleMuseum: (result) => plan.allowsObjects || !isObjectResult(result)
        },
        minResults: MIN_RESULTS,
        adjustScores: withImageScores
      })
    : null;
  const llmResults = rerank?.results ?? null;

  // Bench results (see benchEmptyCategories) ride along outside the main
  // set, so coverage and the top pick only ever consider the real page.
  const mainResults = llmResults?.filter((result) => !result.benchOnly) ?? null;
  const covered = ensureCompoundCoverage(
    mainResults ?? selectWithSourceDiversity(await withImageScores(deduped), limit, selection),
    deduped.filter((result) => !rerank?.rejectedIds.has(result.id)),
    plan,
    limit
  );
  const coveredIds = new Set(covered.map((result) => result.id));
  const benchCandidates = (llmResults ?? []).filter(
    (result) => result.benchOnly && !coveredIds.has(result.id)
  );
  // Bench picks come from the pool, which the pixel checks already measured.
  const { main, bench } = demoteFlatLighting(
    covered,
    applyImageMetrics(benchCandidates, await metricsPromise, {
      lighting: false,
      allowsBlur: plan.allowsBlur
    }).filter((result) => isUsableExtra(result, plan)),
    plan
  );
  // Categories only exist on the LLM path, so only it can have empty ones.
  const categoryFill = llmResults ? await fillEmptyCategories([...main, ...bench], plan, limit) : [];
  const finalResults = [
    ...(llmResults ? chooseTopPick(objectsLast(main, plan), plan) : objectsLast(main, plan)),
    ...bench,
    ...categoryFill
  ];

  const selectedAt = Date.now();

  // Experimental, opt-in (ENABLE_VISUAL_SEARCH): re-orders this final set
  // using lighting/mood/composition tags. See lib/search/visualTagBoost.ts
  // and docs/blip-caption-eval.md.
  const boosted = await applyVisualTagBoost(finalResults, query);

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
