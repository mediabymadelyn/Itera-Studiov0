import { ArtworkResult } from "@/lib/types/artwork";

// Retrieval stays plain keyword search (see aic.ts/met.ts/unsplash.ts) --
// this is the actual LLM query-translation arm: given the user's original
// query text and the candidate pool keyword search already retrieved, an
// LLM picks and orders which candidates actually get shown. It never
// touches retrieval itself, only the final selection step. Reuses the same
// hosted-model setup as the (separate) image-tagging feature in
// visualTags.ts, but this call only ever sees text -- title/artist/tags --
// never images, to keep it fast over a dozen-plus candidates.
const LLM_QUERY_LAYER_API_URL = "https://router.huggingface.co/v1/chat/completions";

// Selection and categorization are two separate calls, not one combined
// prompt. A single call asked to both judge relevance over ~18 candidates
// AND assign a category to each pick was slow and unreliable (measured
// 17-20s+ response times, ~2/3 timing out at a 20s budget) -- and worse,
// the added task appeared to weaken the relevance judgment itself,
// letting previously-filtered irrelevant candidates back in. Splitting
// them: selection alone is the smaller, well-tested prompt (fast,
// reliable); categorization runs only over the already-selected dozen
// results. If categorization fails, results still return -- they just
// render without a match-reason badge.
const SELECTION_TIMEOUT_MS = 18000;

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
const matchReasonCache = new Map<string, string>();

// Closed vocabulary for per-card match-reason badges (and, later, the
// "Based on your search" query-level tags -- same taxonomy, shared across
// both so they're not two disconnected labeling systems). Each name is a
// dimension of reference usefulness, not a subject description, so the
// model can't satisfy it by just restating what's in the image -- and two
// candidates with similar subject matter are forced to land on different
// categories unless they're genuinely strongest on the same one.
const MATCH_REASON_CATEGORIES = [
  "Pose/Gesture",
  "Anatomy/Form",
  "Lighting",
  "Color Palette",
  "Composition",
  "Style/Technique",
  "Texture/Material",
  "Expression/Emotion",
  "Environment/Setting",
  "Historical/Cultural Reference"
] as const;

function normalizeMatchReason(raw: string | undefined): string | undefined {
  if (!raw) return undefined;

  const normalized = raw.trim().toLowerCase().replace(/[.!]+$/, "");

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

function model(): string {
  return (
    process.env.VISUAL_TAGS_MODEL?.trim() ||
    process.env.BLIP_MODEL?.trim() ||
    "google/gemma-3-27b-it"
  );
}

export function isLlmQueryLayerEnabled(): boolean {
  return process.env.ENABLE_LLM_QUERY_LAYER === "true" && Boolean(apiKey());
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

function buildSelectionPrompt(
  query: string,
  candidates: CandidateSummary[],
  limit: number
): string {
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
    `Work in two steps.\n\n` +
    `Step 1: Go through EVERY candidate individually, including ones you might initially skim ` +
    `past, and judge whether it is actually relevant to the query -- the specific subject, ` +
    `pose, or visual quality the user described, not just a loose category match (e.g. "armor" ` +
    `or "a person" is not automatically relevant just because the query mentions a body part or ` +
    `activity). Do not stop at the first plausible candidate from a medium; check all of them.\n\n` +
    `Step 2: From ONLY the candidates you judged genuinely relevant in step 1, choose the ` +
    `${limit} best, ordered best match first. As a tiebreaker only -- never to include an ` +
    `irrelevant candidate or drop a clearly stronger one -- prefer variety: a mix of medium ` +
    `(fine art and photography) and a mix of what makes each pick useful (pose, lighting, ` +
    `color, style, composition, etc.) over several picks that are redundant with each other.\n\n` +
    `Reply with ONLY a JSON array of the chosen index numbers, ordered best first, e.g. ` +
    `[3,0,7,1,5,2]. No other text.`
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
    `For each one, assign exactly ONE category from this fixed list -- copy the spelling ` +
    `exactly as written, do not invent your own wording:\n` +
    `${MATCH_REASON_CATEGORIES.map((c) => `"${c}"`).join(", ")}\n\n` +
    `Pick the SINGLE dimension that makes this specific result most useful as a reference -- ` +
    `not a description of its subject matter (e.g. do not pick a category just because it ` +
    `names something visible in the image; pick the one quality that actually makes THIS result ` +
    `a good reference). If two results share similar subject matter, they should usually get ` +
    `different categories, based on what's actually distinct about each one's reference value -- ` +
    `only give them the same category if they are genuinely strongest on the exact same ` +
    `dimension.\n\n` +
    `Reply with ONLY a JSON array of objects, e.g. ` +
    `[{"index":3,"reason":"Pose/Gesture"},{"index":0,"reason":"Lighting"}]. No other text.`
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

function parseIndices(raw: string, maxIndex: number): number[] | null {
  const parsed = extractJsonArray(raw);
  if (!parsed) return null;

  const indices = parsed
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= maxIndex);

  return indices.length > 0 ? indices : null;
}

type CategoryPick = { index: number; reason?: string };

function parseCategoryPicks(raw: string, maxIndex: number): CategoryPick[] | null {
  const parsed = extractJsonArray(raw);
  if (!parsed) return null;

  const picks = parsed
    .map((entry): CategoryPick | null => {
      if (!entry || typeof entry !== "object" || !("index" in entry)) return null;

      const index = Number((entry as { index: unknown }).index);
      const reasonRaw = (entry as { reason?: unknown }).reason;
      const reason = typeof reasonRaw === "string" ? reasonRaw.trim() : undefined;

      return Number.isInteger(index) ? { index, reason } : null;
    })
    .filter((pick): pick is CategoryPick => pick !== null && pick.index >= 0 && pick.index <= maxIndex);

  return picks.length > 0 ? picks : null;
}

async function callModel(prompt: string, maxTokens: number, timeoutMs: number): Promise<string | null> {
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
        model: model(),
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
): Promise<Map<number, string>> {
  const localSummaries = batch.map((item, localIndex) =>
    summarizeCandidate(item.result, localIndex)
  );
  const prompt = buildCategoryPrompt(query, localSummaries);

  async function attempt(): Promise<Map<number, string> | null> {
    const content = await callModel(prompt, 120, CATEGORY_BATCH_TIMEOUT_MS);
    if (!content) return null;

    const picks = parseCategoryPicks(content, batch.length - 1);
    if (!picks) return null;

    const result = new Map<number, string>();
    for (const pick of picks) {
      const normalized = normalizeMatchReason(pick.reason);
      const globalIndex = batch[pick.index]?.globalIndex;
      if (normalized && globalIndex !== undefined) {
        result.set(globalIndex, normalized);
      }
    }
    return result;
  }

  return (await attempt()) ?? (await attempt()) ?? new Map();
}

/**
 * Labels an already-selected result set with match-reason categories.
 * Cache hits (same result id labeled in a prior search) skip the model
 * entirely. Remaining results are split into small batches, categorized in
 * parallel (not sequentially -- doesn't add latency), each with one retry
 * on failure. Best-effort throughout: any result that never gets a label
 * (cache miss + both attempts on its batch failing) simply renders without
 * one -- a labeling gap never takes the actual results down with it.
 */
async function attachMatchReasons(
  selected: ArtworkResult[],
  query: string
): Promise<ArtworkResult[]> {
  const reasonByIndex = new Map<number, string>();
  const uncached: BatchItem[] = [];

  selected.forEach((result, index) => {
    const cached = matchReasonCache.get(result.id);
    if (cached) {
      reasonByIndex.set(index, cached);
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

  for (const batchMap of batchResults) {
    for (const [globalIndex, reason] of batchMap) {
      reasonByIndex.set(globalIndex, reason);
    }
  }

  if (matchReasonCache.size >= MATCH_REASON_CACHE_MAX_SIZE) {
    matchReasonCache.clear();
  }

  return selected.map((result, index) => {
    const matchReason = reasonByIndex.get(index);
    if (!matchReason) return result;

    matchReasonCache.set(result.id, matchReason);
    return { ...result, matchReason };
  });
}

/**
 * Final relevance layer: an LLM looks at the original query together with
 * the already-retrieved candidate pool and selects + orders which ones
 * actually get shown, then (separately, best-effort) labels each with a
 * match-reason category. Returns null only if selection itself fails
 * (missing key, network error, timeout, unparseable response), so callers
 * fall back to the existing mechanical selection -- never breaks search.
 */
export async function selectWithLlmRerank(
  candidates: ArtworkResult[],
  query: string,
  limit: number
): Promise<ArtworkResult[] | null> {
  if (!apiKey() || candidates.length === 0) {
    return null;
  }

  const summaries = candidates.map((candidate, index) => summarizeCandidate(candidate, index));
  const selectionPrompt = buildSelectionPrompt(query, summaries, limit);

  const content = await callModel(selectionPrompt, 150, SELECTION_TIMEOUT_MS);
  if (!content) return null;

  const indices = parseIndices(content, candidates.length - 1);
  if (!indices) return null;

  const selected = indices
    .map((index) => candidates[index])
    .filter((result): result is ArtworkResult => Boolean(result))
    .slice(0, limit);

  if (selected.length === 0) return null;

  const withReasons = await attachMatchReasons(selected, query);

  // The selection prompt already asks for results ordered best-match-first,
  // so index 0 of the final list *is* the model's top pick -- no separate
  // judgment call needed, just surfacing a ranking signal that already
  // existed. Applied after attachMatchReasons so it survives that step.
  return withReasons.map((result, index) =>
    index === 0 ? { ...result, isTopPick: true } : result
  );
}
