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
const REQUEST_TIMEOUT_MS = 8000;

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

function buildPrompt(query: string, candidates: CandidateSummary[], limit: number): string {
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
    `Reply with ONLY a JSON array of the chosen index numbers, e.g. [3,0,7,1,5,2]. No other text.`
  );
}

function parseIndices(raw: string, maxIndex: number): number[] | null {
  let text = raw.trim();

  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) text = fence[1].trim();

  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) return null;

    const indices = parsed
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= maxIndex);

    return indices.length > 0 ? indices : null;
  } catch {
    return null;
  }
}

/**
 * Final relevance layer: an LLM looks at the original query together with
 * the already-retrieved candidate pool and selects + orders which ones
 * actually get shown. Returns null on any failure (missing key, network
 * error, timeout, unparseable response) so callers fall back to the
 * existing mechanical selection -- never breaks search.
 */
export async function selectWithLlmRerank(
  candidates: ArtworkResult[],
  query: string,
  limit: number
): Promise<ArtworkResult[] | null> {
  const key = apiKey();
  if (!key || candidates.length === 0) {
    return null;
  }

  const summaries = candidates.map((candidate, index) => summarizeCandidate(candidate, index));
  const prompt = buildPrompt(query, summaries, limit);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(LLM_QUERY_LAYER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model(),
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return null;
    }

    const indices = parseIndices(content, candidates.length - 1);
    if (!indices) {
      return null;
    }

    const selected = indices
      .map((index) => candidates[index])
      .filter((result): result is ArtworkResult => Boolean(result))
      .slice(0, limit);

    return selected.length > 0 ? selected : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
