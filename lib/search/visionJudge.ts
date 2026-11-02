import sharp from "sharp";
import { ArtworkResult } from "@/lib/types/artwork";
import { MATCH_REASON_CATEGORIES, MatchReasonCategory } from "@/lib/search/categories";
import { analysisUrl, downloadImage } from "@/lib/search/imageAnalysis";

// One vision-model look at each candidate image answers the three
// questions the rest of the pipeline needs: is it relevant to the search,
// how dramatic is its lighting, and which reference categories it's good
// for. The text-only Gemma steps (relevance, labels) only ever saw titles
// and tags, so they approved oil lamps for "oil painting portrait" and
// woven bags titled "Bag Face" for "dramatic lighting on face".
//
// Model choice comes from a 40-image comparison (Gemini 3.8 Flash vs 3.5
// Flash-Lite vs the Gemma 3 27B this replaces): relevance 31/32 vs 24/32
// for Gemma 3, flat images called dramatic 3/16 vs 6/16, no dramatic
// image missed by either. Medium image detail scored the same as the
// default at ~60% of the tokens. With the graded match below, 7/9 traps
// (oil lamps, bag faces, figurines) scored 0, the other two were genuine
// partial matches (1), and every good result scored 2.
//
// Uses the Gemini API directly (not the Hugging Face router) for JSON
// output and the image-detail setting.

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_VISION_MODEL = "gemini-3.8-flash";
// The slowest image in a search sets how long the step takes; in testing
// the slowest of 40 took ~6s at medium detail.
const JUDGE_TIMEOUT_MS = 8000;
const IMAGE_SIZE = 512;
const MAX_CATEGORIES = 3;

const JUDGMENT_CACHE_MAX_SIZE = 2000;
const judgmentCache = new Map<string, VisionJudgment>();

export type VisionJudgment = {
  // 2 = the whole request, 1 = right subject but missing part of it
  // (setting, pose, lighting), 0 = wrong subject. A yes/no answer was too
  // strict: it rejected every Rembrandt for "side profile dramatic
  // lighting" (right subject, wrong pose) and left pages at 6-8 results.
  match: 0 | 1 | 2;
  // 0 = flat, even light ... 5 = strong chiaroscuro / low-key. Same scale
  // as ArtworkResult.lightingScore.
  lightingScore: number;
  categories: MatchReasonCategory[];
};

function apiKey(): string {
  return process.env.GEMINI_API_KEY?.trim() || "";
}

function visionModel(): string {
  return process.env.VISION_MODEL?.trim() || DEFAULT_VISION_MODEL;
}

export function isVisionJudgeEnabled(): boolean {
  return Boolean(apiKey());
}

function buildPrompt(result: ArtworkResult, query: string): string {
  return (
    `An artist searched an art-reference tool for: "${query}".\n` +
    `This result is titled "${result.title}"${result.artist ? ` by ${result.artist}` : ""} (${result.source}).\n` +
    `Look at the image itself and reply with ONLY JSON:\n` +
    `{"match": 0|1|2, "lighting": 0-5, "categories": [...]}\n` +
    `- match: how well this image serves as a reference for the search. 2 = right subject and ` +
    `everything else the search asks for (action, setting, lighting, pose). 1 = right subject ` +
    `but missing or different on some of the rest. 0 = wrong subject: a 3D object, textile, or ` +
    `unrelated thing that only shares a word with the search.\n` +
    `- lighting: how dramatic and directional the light is: 0 = flat, even light; 3 = clear ` +
    `light and shadow; 5 = strong chiaroscuro / low-key light against deep shadow.\n` +
    `- categories: 1-${MAX_CATEGORIES} of ${JSON.stringify(MATCH_REASON_CATEGORIES)} that this ` +
    `image is most useful for as a reference.`
  );
}

function parseJudgment(raw: string): VisionJudgment | null {
  try {
    const parsed = JSON.parse(raw) as { match?: unknown; lighting?: unknown; categories?: unknown };
    const match = Number(parsed.match);
    const lighting = Number(parsed.lighting);
    if (![0, 1, 2].includes(match) || !Number.isFinite(lighting)) return null;

    const categories = (Array.isArray(parsed.categories) ? parsed.categories : [])
      .map((value) => MATCH_REASON_CATEGORIES.find((category) => category === value))
      .filter((category): category is MatchReasonCategory => Boolean(category));

    return {
      match: match as VisionJudgment["match"],
      lightingScore: Math.max(0, Math.min(5, Math.round(lighting))),
      categories: Array.from(new Set(categories)).slice(0, MAX_CATEGORIES)
    };
  } catch {
    return null;
  }
}

async function judgeOne(result: ArtworkResult, query: string): Promise<VisionJudgment | null> {
  const original = await downloadImage(analysisUrl(result));
  if (!original) return null;

  try {
    const image = await sharp(original)
      .resize(IMAGE_SIZE, IMAGE_SIZE, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    const response = await fetch(`${GEMINI_API_URL}/${visionModel()}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey(), "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: buildPrompt(result, query) },
              { inline_data: { mime_type: "image/jpeg", data: image.toString("base64") } }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          mediaResolution: "MEDIA_RESOLUTION_MEDIUM",
          temperature: 0,
          thinkingConfig: { thinkingLevel: "low" }
        }
      }),
      signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS)
    });
    if (!response.ok) return null;

    const data = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    return parseJudgment(text);
  } catch {
    return null;
  }
}

/**
 * Judges every result's image in parallel. Never throws: an image that
 * fails to download, times out, or comes back unparseable simply has no
 * judgment, and callers treat it as unjudged rather than as rejected.
 * Judgments are cached per (query, result), since relevance depends on
 * the query.
 */
export async function judgeResultImages(
  results: ArtworkResult[],
  query: string
): Promise<Map<string, VisionJudgment>> {
  const normalizedQuery = query.trim().toLowerCase();

  const entries = await Promise.all(
    results.map(async (result) => {
      const cacheKey = `${normalizedQuery}|${result.id}`;
      const cached = judgmentCache.get(cacheKey);
      if (cached) return [result.id, cached] as const;

      const judgment = await judgeOne(result, query);
      if (judgment) {
        if (judgmentCache.size >= JUDGMENT_CACHE_MAX_SIZE) judgmentCache.clear();
        judgmentCache.set(cacheKey, judgment);
      }
      return [result.id, judgment] as const;
    })
  );

  return new Map(
    entries.filter((entry): entry is readonly [string, VisionJudgment] => entry[1] !== null)
  );
}
