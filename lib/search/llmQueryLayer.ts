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
// results, a much simpler task. If categorization fails, results still
// return -- they just render without a match-reason badge.
const SELECTION_TIMEOUT_MS = 15000;
const CATEGORY_TIMEOUT_MS = 15000;

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

  return MATCH_REASON_CATEGORIES.find((category) => category === normalized);
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
    `${limit} best, ordered best match first. If genuinely relevant candidates exist in more ` +
    `than one medium (fine art vs. photography), prefer keeping that mix rather than collapsing ` +
    `to a single medium -- but never promote a candidate that didn't clear step 1 just to add ` +
    `variety, and never omit a clearly strong match to make room for a weaker one.\n\n` +
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
    `[{"index":3,"reason":"pose/gesture"},{"index":0,"reason":"lighting"}]. No other text.`
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

/**
 * Labels an already-selected result set with match-reason categories.
 * Best-effort: on any failure (timeout, bad response, unparseable JSON),
 * returns the input unchanged -- a labeling failure should never take the
 * actual results down with it.
 */
async function attachMatchReasons(
  selected: ArtworkResult[],
  query: string
): Promise<ArtworkResult[]> {
  const summaries = selected.map((result, index) => summarizeCandidate(result, index));
  const prompt = buildCategoryPrompt(query, summaries);

  const content = await callModel(prompt, 250, CATEGORY_TIMEOUT_MS);
  if (!content) return selected;

  const picks = parseCategoryPicks(content, selected.length - 1);
  if (!picks) return selected;

  const reasonByIndex = new Map<number, string>();
  for (const pick of picks) {
    const normalized = normalizeMatchReason(pick.reason);
    if (normalized) reasonByIndex.set(pick.index, normalized);
  }

  return selected.map((result, index) => {
    const matchReason = reasonByIndex.get(index);
    return matchReason ? { ...result, matchReason } : result;
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

  return attachMatchReasons(selected, query);
}
