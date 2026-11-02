import { ArtworkResult, VisualTags } from "@/lib/types/artwork";
import { SelectionOptions, selectWithSourceDiversity } from "@/lib/search/selectDiverseResults";
import { describeVisualTags } from "@/lib/search/visualTags";
import { MATCH_REASON_CATEGORIES, MatchReasonCategory } from "@/lib/search/categories";
import { isVisionJudgeEnabled, judgeResultImages, VisionJudgment } from "@/lib/search/visionJudge";

// Retrieval stays plain keyword search (see aic.ts/met.ts/unsplash.ts) --
// this is the actual LLM query-translation arm: given the user's original
// query text and the candidate pool keyword search already retrieved, an
// LLM picks and orders which candidates actually get shown. It never
// touches retrieval itself. When GEMINI_API_KEY is set, selection runs on
// the images themselves (see visionJudge.ts and selectWithVisionJudge at
// the bottom of this file); the text-only Gemma path below -- title/artist/
// tags, never images -- is the fallback when it isn't, or when Gemini fails.
const LLM_QUERY_LAYER_API_URL = "https://router.huggingface.co/v1/chat/completions";

// Selection is a relevance FILTER, not a ranker -- the LLM judges each
// candidate independently (relevant or not), then the already-tested
// selectWithSourceDiversity() deterministically picks and orders the final
// set from whatever it approved. This split matters: the original design
// asked one call to both judge relevance across the whole pool AND rank/
// diversify the chosen ones, which was slow and got less reliable as the
// pool grew (measured 17-20s+ at just 18 candidates). A pure per-candidate
// relevance judgment is a much simpler task, so it's safe to split across
// small parallel chunks the same way categorization already was -- each
// chunk only has to say yes/no about its own few candidates, never compare
// across chunks, so there's no cross-chunk ranking to get wrong. A chunk
// that fails (after one retry) just contributes zero candidates rather than
// guessing -- consistent with never including something the LLM didn't
// actually vet.
const SELECTION_CHUNK_SIZE = 10;
const SELECTION_CHUNK_TIMEOUT_MS = 15000;

// Categorization is further split into small parallel batches rather than
// one call for the whole selected set: a single call for ~12 items was an
// all-or-nothing failure mode (one timeout meant zero labels for the whole
// search). Smaller batches are individually faster and more reliable, run
// concurrently (not sequentially, so this doesn't add latency), and a
// failure only costs labels on that one batch's few items instead of
// everything. Each batch also gets one cheap retry on failure -- cheap
// specifically because the batch is small, unlike retrying the old
// monolithic call would have been.
const CATEGORY_BATCH_SIZE = 4;
const CATEGORY_BATCH_TIMEOUT_MS = 12000;

// Per-result-id cache so re-selecting the same result across searches (very
// common when iterating on the same test queries) skips the model call
// entirely and reuses its last real category. Best-effort, in-memory, not
// persisted across server restarts -- a nice-to-have speed/reliability
// boost, not something correctness depends on. Capped to avoid unbounded
// growth in a long-running process.
const MATCH_REASON_CACHE_MAX_SIZE = 500;
type CachedLabels = { reasons: string[]; lightingScore?: number };
const matchReasonCache = new Map<string, CachedLabels>();

// Testers found single labels too narrow (P2, P3: categories overlap), so
// each result gets up to this many, strongest first.
const MAX_MATCH_REASONS = 3;

// "Lighting" was the most-mislabeled category (P2, P3: hands holding a cup
// filed under Lighting), because the labeling model only ever sees text.
// Results it labels Lighting get one vision check each, in parallel; the
// vision model's read of the actual image decides whether the label stays
// and orders results within the Lighting filter. A failed or slow check
// keeps the text label rather than dropping it.
const LIGHTING_CATEGORY: MatchReasonCategory = "Lighting";
const LIGHTING_CHECK_TIMEOUT_MS = 4000;
const LIGHTING_MIN_CONFIDENCE = 0.5;
const LIGHTING_MIN_SCORE = 2;

// Every category should have something to show when it's selected. After
// the final set is labeled, any category still empty gets one fast-model
// call over the candidates that didn't make the page, picking up to this
// many per category. Those "bench" results only appear under that
// category's filter, so the main grid is unchanged.
const BENCH_PER_CATEGORY = 2;
const BENCH_TIMEOUT_MS = 3000;

// Closed category vocabulary: see lib/search/categories.ts.

// Testers couldn't tell Pose/Gesture from Anatomy/Form (P2, P5), so they
// were merged; the old names still map in case the model uses them.
const LEGACY_CATEGORY_NAMES: Record<string, string> = {
  "pose/gesture": "Pose/Anatomy",
  "anatomy/form": "Pose/Anatomy",
  pose: "Pose/Anatomy",
  anatomy: "Pose/Anatomy"
};

function normalizeMatchReason(raw: string | undefined): string | undefined {
  if (!raw) return undefined;

  const normalized = raw.trim().toLowerCase().replace(/[.!]+$/, "");
  if (LEGACY_CATEGORY_NAMES[normalized]) return LEGACY_CATEGORY_NAMES[normalized];

  // Compare case-insensitively but return the canonical (as-declared) casing
  // from the list, so MATCH_REASON_CATEGORIES' own casing always wins
  // regardless of how the model capitalizes its output.
  return MATCH_REASON_CATEGORIES.find(
    (category) => category.toLowerCase() === normalized
  );
}

function apiKey(): string {
  return process.env.HUGGINGFACE_API_KEY?.trim() || process.env.BLIP_API_KEY?.trim() || "";
}

// Used for the newer, latency-sensitive steps (query rewrite in
// queryPlan.ts, category backfill below). Measured ~0.9s per call on the HF
// router vs ~2.5s for the Gemma model the relevance/labeling steps use.
// Overridable for comparison runs.
const DEFAULT_FAST_MODEL = "meta-llama/Llama-3.3-70B-Instruct:fastest";

export function fastModel(): string {
  return process.env.FAST_LLM_MODEL?.trim() || DEFAULT_FAST_MODEL;
}

function model(): string {
  return (
    process.env.VISUAL_TAGS_MODEL?.trim() ||
    process.env.BLIP_MODEL?.trim() ||
    "google/gemma-3-27b-it"
  );
}

export function isLlmQueryLayerEnabled(): boolean {
  return process.env.ENABLE_LLM_QUERY_LAYER === "true" && (Boolean(apiKey()) || isVisionJudgeEnabled());
}

type CandidateSummary = {
  index: number;
  title: string;
  artist: string;
  source: string;
  tags: string;
};

function summarizeCandidate(result: ArtworkResult, index: number): CandidateSummary {
  const tagBits = [
    ...(result.tags ?? []),
    ...(result.subjectTitles ?? []),
    ...(result.styleTitles ?? []),
    ...(result.themeTitles ?? []),
    result.medium
  ].filter((bit): bit is string => Boolean(bit && bit.trim()));

  return {
    index,
    title: result.title,
    artist: result.artist,
    source: result.source,
    tags: tagBits.join(", ")
  };
}

function buildRelevancePrompt(query: string, candidates: CandidateSummary[]): string {
  const listing = candidates
    .map(
      (c) =>
        `${c.index}. "${c.title}" by ${c.artist} (${c.source})${c.tags ? ` -- ${c.tags}` : ""}`
    )
    .join("\n");

  return (
    `A user searched an art-reference tool for: "${query}"\n\n` +
    `Here are ${candidates.length} candidate results, already retrieved by keyword search. ` +
    `The Metropolitan Museum of Art and the Art Institute of Chicago are historical fine-art ` +
    `collections (paintings, sculpture, prints); Unsplash is modern photography:\n${listing}\n\n` +
    `Go through EVERY candidate individually, including ones you might initially skim past, ` +
    `and judge whether it is actually relevant to the query -- the specific subject, pose, or ` +
    `visual quality the user described, not just a loose category match (e.g. "armor" or "a ` +
    `person" is not automatically relevant just because the query mentions a body part or ` +
    `activity). Do not stop at the first plausible candidate; check all of them independently.\n\n` +
    `Reply with ONLY a JSON array of the index numbers you judged genuinely relevant, in any ` +
    `order, e.g. [2,0,5]. If none of them are relevant, reply with []. No other text.`
  );
}

function buildCategoryPrompt(query: string, candidates: CandidateSummary[]): string {
  const listing = candidates
    .map(
      (c) =>
        `${c.index}. "${c.title}" by ${c.artist} (${c.source})${c.tags ? ` -- ${c.tags}` : ""}`
    )
    .join("\n");

  return (
    `A user searched an art-reference tool for: "${query}"\n\n` +
    `These ${candidates.length} results were already judged relevant and selected -- do not ` +
    `re-evaluate whether they belong, only label them:\n${listing}\n\n` +
    `For each one, assign 1 to ${MAX_MATCH_REASONS} categories from this fixed list, strongest ` +
    `first -- copy the spelling exactly as written, do not invent your own wording:\n` +
    `${MATCH_REASON_CATEGORIES.map((c) => `"${c}"`).join(", ")}\n\n` +
    `Pick the dimensions that make this specific result useful as a reference -- not a ` +
    `description of its subject matter (e.g. do not pick a category just because it names ` +
    `something visible in the image). Only add a second or third category if the result is ` +
    `genuinely strong on it too; one category is fine. Only pick "Lighting" when the light ` +
    `itself (direction, contrast, shadows) is a notable feature, not just because an object ` +
    `such as a cup or a window is mentioned.\n\n` +
    `Reply with ONLY a JSON array of objects, e.g. ` +
    `[{"index":3,"reasons":["Pose/Anatomy","Expression/Emotion"]},{"index":0,"reasons":["Lighting"]}]. ` +
    `No other text.`
  );
}

function extractJsonArray(raw: string): unknown[] | null {
  let text = raw.trim();

  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) text = fence[1].trim();

  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// null means "couldn't parse a response at all" (worth retrying); a
// resolved [] is a legitimate answer ("none of this chunk was relevant")
// and must NOT be treated the same as a failure, or a chunk that correctly
// found nothing relevant would be retried pointlessly every time.
function parseRelevantIndices(raw: string, maxIndex: number): number[] | null {
  const parsed = extractJsonArray(raw);
  if (!parsed) return null;

  return parsed
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= maxIndex);
}

type CategoryPick = { index: number; reasons: string[] };

function parseCategoryPicks(raw: string, maxIndex: number): CategoryPick[] | null {
  const parsed = extractJsonArray(raw);
  if (!parsed) return null;

  const picks = parsed
    .map((entry): CategoryPick | null => {
      if (!entry || typeof entry !== "object" || !("index" in entry)) return null;

      const index = Number((entry as { index: unknown }).index);
      const { reasons: reasonsRaw, reason: reasonRaw } = entry as {
        reasons?: unknown;
        reason?: unknown;
      };
      const candidates = Array.isArray(reasonsRaw) ? reasonsRaw : [reasonRaw];
      const reasons = candidates.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0
      );

      return Number.isInteger(index) ? { index, reasons } : null;
    })
    .filter((pick): pick is CategoryPick => pick !== null && pick.index >= 0 && pick.index <= maxIndex);

  return picks.length > 0 ? picks : null;
}

export async function callModel(
  prompt: string,
  maxTokens: number,
  timeoutMs: number,
  modelOverride?: string
): Promise<string | null> {
  const key = apiKey();
  if (!key) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(LLM_QUERY_LAYER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: modelOverride ?? model(),
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }]
      }),
      signal: controller.signal
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };

    return data.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

type BatchItem = { globalIndex: number; result: ArtworkResult };

/**
 * Categorizes one small batch of already-selected results, retrying once
 * on failure (cheap here specifically because the batch is small). Never
 * throws -- resolves to an empty map if both attempts fail, so a bad batch
 * only costs labels on its own few items.
 */
async function categorizeBatch(
  batch: BatchItem[],
  query: string
): Promise<Map<number, string[]>> {
  const localSummaries = batch.map((item, localIndex) =>
    summarizeCandidate(item.result, localIndex)
  );
  const prompt = buildCategoryPrompt(query, localSummaries);

  async function attempt(): Promise<Map<number, string[]> | null> {
    const content = await callModel(prompt, 200, CATEGORY_BATCH_TIMEOUT_MS);
    if (!content) return null;

    const picks = parseCategoryPicks(content, batch.length - 1);
    if (!picks) return null;

    const result = new Map<number, string[]>();
    for (const pick of picks) {
      const normalized = Array.from(
        new Set(
          pick.reasons
            .map((reason) => normalizeMatchReason(reason))
            .filter((reason): reason is string => Boolean(reason))
        )
      ).slice(0, MAX_MATCH_REASONS);
      const globalIndex = batch[pick.index]?.globalIndex;
      if (normalized.length > 0 && globalIndex !== undefined) {
        result.set(globalIndex, normalized);
      }
    }
    return result;
  }

  return (await attempt()) ?? (await attempt()) ?? new Map();
}

/**
 * Scores how notable an image's lighting is from the vision model's tags:
 * high contrast, hard light and directional (side/back/top/under) light
 * each count. Returns null when the model wasn't confident enough to say.
 */
function scoreLighting(tags: VisualTags): number | null {
  if ((tags.confidence ?? 0) < LIGHTING_MIN_CONFIDENCE) return null;

  let score = 0;
  if (tags.contrast === "high") score += 2;
  else if (tags.contrast === "medium") score += 1;
  if (tags.lightingQuality === "hard") score += 2;
  else if (tags.lightingQuality === "mixed") score += 1;
  if (["side-left", "side-right", "back", "above", "below"].includes(tags.lightingDirection)) {
    score += 1;
  }

  return score;
}

async function verifyLighting(result: ArtworkResult): Promise<CachedLabels | null> {
  const reasons = result.matchReasons ?? [];
  const tags = await describeVisualTags(
    result.thumbnailUrl || result.imageUrl,
    LIGHTING_CHECK_TIMEOUT_MS
  );
  const lightingScore = tags ? scoreLighting(tags) : null;

  if (lightingScore === null) return null;

  return lightingScore >= LIGHTING_MIN_SCORE
    ? { reasons, lightingScore }
    : { reasons: reasons.filter((reason) => reason !== LIGHTING_CATEGORY) };
}

/**
 * Labels an already-selected result set with 1-3 match-reason categories.
 * Cache hits (same result id labeled in a prior search) skip the model
 * entirely. Remaining results are split into small batches, categorized in
 * parallel (not sequentially -- doesn't add latency), each with one retry
 * on failure. Then any newly labeled "Lighting" result gets a vision check
 * (see LIGHTING_CATEGORY above). Best-effort throughout: any result that
 * never gets a label (cache miss + both attempts on its batch failing)
 * simply renders without one -- a labeling gap never takes the actual
 * results down with it.
 */
async function attachMatchReasons(
  selected: ArtworkResult[],
  query: string
): Promise<ArtworkResult[]> {
  const labelsByIndex = new Map<number, CachedLabels>();
  const uncached: BatchItem[] = [];

  selected.forEach((result, index) => {
    const cached = matchReasonCache.get(result.id);
    if (cached) {
      labelsByIndex.set(index, cached);
    } else {
      uncached.push({ globalIndex: index, result });
    }
  });

  const batches: BatchItem[][] = [];
  for (let i = 0; i < uncached.length; i += CATEGORY_BATCH_SIZE) {
    batches.push(uncached.slice(i, i + CATEGORY_BATCH_SIZE));
  }

  const batchResults = await Promise.all(
    batches.map((batch) => categorizeBatch(batch, query))
  );

  const newlyLabeled: number[] = [];
  for (const batchMap of batchResults) {
    for (const [globalIndex, reasons] of batchMap) {
      labelsByIndex.set(globalIndex, { reasons });
      newlyLabeled.push(globalIndex);
    }
  }

  await Promise.all(
    newlyLabeled
      .filter((index) => labelsByIndex.get(index)?.reasons.includes(LIGHTING_CATEGORY))
      .map(async (index) => {
        const verified = await verifyLighting({
          ...selected[index],
          matchReasons: labelsByIndex.get(index)?.reasons
        });
        if (verified) labelsByIndex.set(index, verified);
      })
  );

  if (matchReasonCache.size >= MATCH_REASON_CACHE_MAX_SIZE) {
    matchReasonCache.clear();
  }

  return selected.map((result, index) => {
    const labels = labelsByIndex.get(index);
    if (!labels) return result;

    matchReasonCache.set(result.id, labels);
    if (labels.reasons.length === 0) return result;

    return {
      ...result,
      matchReasons: labels.reasons,
      lightingScore: labels.lightingScore
    };
  });
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

/**
 * Filters one small chunk for relevance using two independent reads, run
 * IN PARALLEL (not sequentially -- costs no extra wall-clock time over a
 * single call, since both finish around the same time). Returns the union
 * of whatever either read approved, rather than picking one read over the
 * other: item-level judgment has real variance -- a specific candidate
 * approved in one read and missed in the other isn't rare, even when the
 * overall approval *rate* looks reasonable in both. The two reads use
 * different orderings of the same chunk, not identical prompts -- testing
 * showed a model response for a given prompt is close enough to
 * deterministic that two reads of the exact same prompt tended to repeat
 * the exact same mistake rather than acting as genuinely independent
 * looks. Shuffling breaks that without changing what's actually being
 * judged. Never throws -- resolves to [] if both reads fail to even
 * parse, so a bad chunk only costs its own few candidates rather than the
 * whole search.
 */
async function relevanceFilterChunk(
  chunk: BatchItem[],
  query: string
): Promise<ArtworkResult[]> {
  async function attempt(orderedChunk: BatchItem[]): Promise<ArtworkResult[] | null> {
    const localSummaries = orderedChunk.map((item, localIndex) =>
      summarizeCandidate(item.result, localIndex)
    );
    const prompt = buildRelevancePrompt(query, localSummaries);

    const content = await callModel(prompt, 150, SELECTION_CHUNK_TIMEOUT_MS);
    if (!content) return null;

    const indices = parseRelevantIndices(content, orderedChunk.length - 1);
    if (indices === null) return null;

    return indices
      .map((localIndex) => orderedChunk[localIndex]?.result)
      .filter((result): result is ArtworkResult => Boolean(result));
  }

  const [readA, readB] = await Promise.all([attempt(chunk), attempt(shuffled(chunk))]);

  const approved = new Map<string, ArtworkResult>();
  for (const result of [...(readA ?? []), ...(readB ?? [])]) {
    approved.set(result.id, result);
  }

  return Array.from(approved.values());
}

function buildBenchPrompt(
  query: string,
  categories: string[],
  candidates: CandidateSummary[]
): string {
  const listing = candidates
    .map(
      (c) =>
        `${c.index}. "${c.title}" by ${c.artist} (${c.source})${c.tags ? ` -- ${c.tags}` : ""}`
    )
    .join("\n");

  return (
    `A user searched an art-reference tool for: "${query}"\n\n` +
    `Candidate results:\n${listing}\n\n` +
    `For each of these reference categories: ${categories.map((c) => `"${c}"`).join(", ")} -- ` +
    `pick up to ${BENCH_PER_CATEGORY} candidates that are relevant to the search AND genuinely ` +
    `useful as a reference for that category. Use [] for a category when nothing fits; never ` +
    `pick something irrelevant just to fill it. Only pick "Lighting" when the light itself ` +
    `(direction, contrast, shadows) is notable.\n\n` +
    `Reply with ONLY a JSON object mapping each category to an array of index numbers, e.g. ` +
    `{"Lighting":[4],"Composition":[]}. No other text.`
  );
}

function parseBenchPicks(raw: string, maxIndex: number): Map<number, string[]> {
  const picks = new Map<number, string[]>();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return picks;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return picks;
  }
  if (!parsed || typeof parsed !== "object") return picks;

  for (const [rawCategory, indices] of Object.entries(parsed as Record<string, unknown>)) {
    const category = normalizeMatchReason(rawCategory);
    if (!category || !Array.isArray(indices)) continue;

    for (const value of indices.slice(0, BENCH_PER_CATEGORY)) {
      const index = Number(value);
      if (!Number.isInteger(index) || index < 0 || index > maxIndex) continue;
      picks.set(index, [...(picks.get(index) ?? []), category]);
    }
  }

  return picks;
}

/**
 * Fills categories the final set left empty with candidates that didn't
 * make the page (see BENCH_PER_CATEGORY). Best-effort: a failed or slow
 * call just means no bench, and Lighting picks still go through the
 * vision check like any other Lighting label.
 */
async function benchEmptyCategories(
  labeled: ArtworkResult[],
  candidates: ArtworkResult[],
  query: string
): Promise<ArtworkResult[]> {
  const covered = new Set(labeled.flatMap((result) => result.matchReasons ?? []));
  const emptyCategories = MATCH_REASON_CATEGORIES.filter((category) => !covered.has(category));
  const shownIds = new Set(labeled.map((result) => result.id));
  const leftovers = candidates.filter((result) => !shownIds.has(result.id));

  if (emptyCategories.length === 0 || leftovers.length === 0) return [];

  const content = await callModel(
    buildBenchPrompt(query, emptyCategories, leftovers.map(summarizeCandidate)),
    300,
    BENCH_TIMEOUT_MS,
    fastModel()
  );
  if (!content) return [];

  const picks = parseBenchPicks(content, leftovers.length - 1);
  const benched = Array.from(picks.entries()).map(([index, reasons]) => ({
    ...leftovers[index],
    matchReasons: reasons,
    benchOnly: true
  }));

  const checked = await Promise.all(
    benched.map(async (result) => {
      if (!result.matchReasons.includes(LIGHTING_CATEGORY)) return result;

      const verified = await verifyLighting(result);
      return verified
        ? { ...result, matchReasons: verified.reasons, lightingScore: verified.lightingScore }
        : result;
    })
  );

  return checked.filter((result) => result.matchReasons.length > 0);
}

export type RerankOptions = {
  selection?: SelectionOptions;
  // Used instead of `selection` when the vision model judged the pool:
  // every approved work already shows the right subject, so museum
  // eligibility can be about what kind of work it is instead.
  visionSelection?: SelectionOptions;
  // Applied to the approved results before the final pick -- used to fold
  // in pixel checks that ran in parallel with the relevance calls.
  adjustScores?: (results: ArtworkResult[]) => Promise<ArtworkResult[]>;
  // When the LLM approves fewer than this, the page is topped up with the
  // next-best candidates (already subject-checked upstream), ranked below
  // every approved one. Testers found 5-6 results too few to work with.
  minResults?: number;
};

export type RerankOutcome = {
  results: ArtworkResult[];
  // Results the vision model looked at and judged the wrong subject. Later
  // steps that add results back (compound-query coverage in searchAll.ts)
  // must skip these, or rejected oil lamps could return. Empty on the text
  // path.
  rejectedIds: Set<string>;
};

// Top-up results are placed strictly below the lowest approved score.
const FILL_SCORE_STEP = 0.01;

function topUp(
  approved: ArtworkResult[],
  candidates: ArtworkResult[],
  target: number
): ArtworkResult[] {
  if (approved.length >= target) return approved;

  const approvedIds = new Set(approved.map((result) => result.id));
  const floor = Math.min(...approved.map((result) => result.score ?? 0));

  const fill = candidates
    .filter((result) => !approvedIds.has(result.id))
    .slice(0, target - approved.length)
    .map((result, index) => ({
      ...result,
      score: Number((floor - FILL_SCORE_STEP * (index + 1)).toFixed(4))
    }));

  return [...approved, ...fill];
}

/**
 * Final relevance layer: the candidate pool is split into small chunks,
 * each independently judged for relevance in parallel (never ranked
 * against each other -- see the SELECTION_CHUNK_SIZE comment above for
 * why). The union of everything approved is then handed to
 * selectWithSourceDiversity() -- the same deterministic, already-tested
 * function the plain keyword path uses -- to pick and order the final
 * set with a source/medium mix, topped up to `minResults` if the LLM was
 * strict. Each result that makes the cut is then (separately, best-effort)
 * labeled with match-reason categories. Returns null only if nothing
 * survives relevance filtering at all (missing key, total failure, or a
 * genuinely empty pool), so callers fall back to the existing mechanical
 * selection -- never breaks search. The top pick is chosen by the caller
 * (searchAll.ts), which knows the full query plan.
 */
export async function selectWithLlmRerank(
  candidates: ArtworkResult[],
  query: string,
  limit: number,
  options: RerankOptions = {}
): Promise<RerankOutcome | null> {
  if (candidates.length === 0) return null;

  if (isVisionJudgeEnabled()) {
    const judged = await selectWithVisionJudge(candidates, query, limit, options);
    if (judged) return judged;
    // Gemini unavailable for this search: fall through to the text path.
  }

  if (!apiKey()) {
    return null;
  }

  const items: BatchItem[] = candidates.map((result, globalIndex) => ({
    globalIndex,
    result
  }));

  const chunks: BatchItem[][] = [];
  for (let i = 0; i < items.length; i += SELECTION_CHUNK_SIZE) {
    chunks.push(items.slice(i, i + SELECTION_CHUNK_SIZE));
  }

  const chunkResults = await Promise.all(
    chunks.map((chunk) => relevanceFilterChunk(chunk, query))
  );

  const approved = chunkResults.flat();
  if (approved.length === 0) return null;
  const relevant = (options.adjustScores ? await options.adjustScores(approved) : approved).sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0)
  );

  const assembled = selectWithSourceDiversity(relevant, limit, options.selection);
  if (assembled.length === 0) return null;

  const filled = topUp(assembled, candidates, Math.min(options.minResults ?? 0, limit));
  const labeled = await attachMatchReasons(filled, query);
  const bench = await benchEmptyCategories(labeled, candidates, query);

  return { results: [...labeled, ...bench], rejectedIds: new Set() };
}

// --- Vision path (Gemini; see visionJudge.ts) -------------------------------

// "Lighting" stays as a label only when the image's light is at least
// "clear light and shadow" on the vision scale.
const VISION_LIGHTING_LABEL_MIN = 3;
// Results matching the whole request (match 2) rank ahead of partial
// matches (1) unless the keyword ranking strongly disagrees.
const FULL_MATCH_BONUS = 0.3;

function withJudgment(result: ArtworkResult, judgment: VisionJudgment | undefined): ArtworkResult {
  if (!judgment) return result;

  const reasons = judgment.categories.filter(
    (category) => category !== LIGHTING_CATEGORY || judgment.lightingScore >= VISION_LIGHTING_LABEL_MIN
  );
  const bonus = judgment.match === 2 ? FULL_MATCH_BONUS : 0;
  return {
    ...result,
    matchReasons: reasons.length > 0 ? reasons : undefined,
    lightingScore: judgment.lightingScore,
    visionMatch: judgment.match === 0 ? undefined : judgment.match,
    score: Number(((result.score ?? 0) + bonus).toFixed(4))
  };
}

/**
 * Same shape as the text path below it -- relevance filter, score
 * adjustments, diversity selection, top-up, labels, bench -- but every
 * answer comes from one vision call per image, made in parallel, so
 * labels and the bench need no further model calls. Returns null when no
 * image could be judged at all (key or API problem), so the caller falls
 * back to the text path.
 */
async function selectWithVisionJudge(
  candidates: ArtworkResult[],
  query: string,
  limit: number,
  options: RerankOptions
): Promise<RerankOutcome | null> {
  const judgments = await judgeResultImages(candidates, query);
  if (judgments.size === 0) return null;

  const judged = candidates.map((result) => withJudgment(result, judgments.get(result.id)));
  const approved = judged.filter((result) => (judgments.get(result.id)?.match ?? 0) >= 1);
  if (approved.length === 0) return null;

  const relevant = (options.adjustScores ? await options.adjustScores(approved) : approved).sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0)
  );
  // The reserved museum slots normally need a caption that names the whole
  // request (action and setting). Museum titles rarely do -- "Naked man
  // walking to the right" never says "city" -- so "man walking in city"
  // showed no art at all. Every approved work here was judged from its
  // image to show at least the right subject, so visionSelection decides
  // eligibility instead.
  const assembled = selectWithSourceDiversity(relevant, limit, options.visionSelection);
  if (assembled.length === 0) return null;

  // Top-up only draws on images the model didn't get to (timeouts), never
  // on ones it looked at and rejected -- those are the oil lamps.
  const unjudged = judged.filter((result) => !judgments.has(result.id));
  const filled = topUp(assembled, unjudged, Math.min(options.minResults ?? 0, limit));

  const covered = new Set(filled.flatMap((result) => result.matchReasons ?? []));
  const shownIds = new Set(filled.map((result) => result.id));
  const leftovers = relevant.filter((result) => !shownIds.has(result.id));
  const bench = MATCH_REASON_CATEGORIES.filter((category) => !covered.has(category)).flatMap(
    (category) =>
      leftovers
        .filter((result) => result.matchReasons?.includes(category))
        .slice(0, BENCH_PER_CATEGORY)
        .map((result) => ({ ...result, matchReasons: [category], benchOnly: true }))
  );

  const rejectedIds = new Set(
    Array.from(judgments.entries())
      .filter(([, judgment]) => judgment.match === 0)
      .map(([id]) => id)
  );

  return { results: [...filled, ...bench], rejectedIds };
}
