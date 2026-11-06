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
// Lighting is no longer a single 0-5 guess. Asked for one number, the
// model gave 4 to every "dramatic lighting on face" result the user called
// flat (glowing face paint on black, sun rays, soft window light, a softly
// lit museum portrait) and 5 to the ones they called dramatic. It saw a
// difference but couldn't place the line. So it now describes the light on
// the subject in parts (sources, hard/soft, direction, how much of the
// subject is in deep shadow, type) and lightingScoreFor() below turns those
// into the 0-5 score with a fixed rule: dramatic means one isolated, hard
// light leaving a real part of the subject in shadow. The artist's name is
// also left out of the prompt, so a Rembrandt is judged on the image, not
// the painter's reputation. A face hidden behind a hand counts as no match
// for a face search ("Woman shielding face with hand" was approved).
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
// Part of the cache key, so judgments made under an earlier prompt aren't
// reused. Bump when buildPrompt changes.
const PROMPT_VERSION = 4;

// What kind of light falls on the subject. Shown to users in the expanded
// view; "even" and "patterned" light also cap the dramatic score.
export const LIGHTING_TYPES = [
  "single source",
  "side / split",
  "rim / back",
  "silhouette",
  "under / top",
  "soft window",
  "even / flat",
  "high-key",
  "dappled / patterned",
  "colored / neon",
  "sunlight / golden hour"
] as const;
export type LightingType = (typeof LIGHTING_TYPES)[number];

export type LightingProfile = {
  // Distinct lights falling on the subject; 3 means three or more, or
  // ambient light with no clear source.
  sources: 1 | 2 | 3;
  quality: "hard" | "soft";
  direction: "front" | "side" | "back" | "top" | "below" | "ambient";
  // How much of the subject is in deep shadow: 0 none, 1 a little, 2 about
  // a third, 3 half or more.
  shadow: 0 | 1 | 2 | 3;
  type: LightingType;
};

const DIRECTIONS: LightingProfile["direction"][] = ["front", "side", "back", "top", "below", "ambient"];
// Types that can't be dramatic however the other parts read: light spread
// evenly over the subject, or broken into stripes and dapples.
const FLAT_TYPES: LightingType[] = ["even / flat", "high-key"];
const PATTERNED_TYPES: LightingType[] = ["dappled / patterned"];
const FLAT_TYPE_MAX_SCORE = 1;
const PATTERNED_TYPE_MAX_SCORE = 3;

// Below this much of the subject in deep shadow (half or more), light
// isn't dramatic however hard or isolated it is. Set from the user's own
// verdicts on "dramatic lighting on face": every image they called
// dramatic had half or more of the face in shadow, and the two hard,
// side-lit ones they rejected (sun rays on a face, a museum portrait) had
// about a third.
const DRAMATIC_MIN_SHADOW = 3;
const NOT_DRAMATIC_MAX_SCORE = 3;

/**
 * The 0-5 lighting score, from the parts the model described: shadow on
 * the subject (0-3), +1 for a single isolated source, +1 for hard light.
 * Dramatic (4+, see imageAnalysis.ts) needs half or more of the subject in
 * deep shadow plus a single source or hard light; 5 needs both. Soft
 * window light on a face scores about 2; candlelight leaving half a face
 * dark scores 4-5.
 */
export function lightingScoreFor(profile: LightingProfile): number {
  let score = profile.shadow + (profile.sources === 1 ? 1 : 0) + (profile.quality === "hard" ? 1 : 0);
  if (profile.shadow < DRAMATIC_MIN_SHADOW) score = Math.min(score, NOT_DRAMATIC_MAX_SCORE);
  if (FLAT_TYPES.includes(profile.type)) score = Math.min(score, FLAT_TYPE_MAX_SCORE);
  if (PATTERNED_TYPES.includes(profile.type)) score = Math.min(score, PATTERNED_TYPE_MAX_SCORE);
  return Math.max(0, Math.min(5, score));
}
const judgmentCache = new Map<string, VisionJudgment>();

export type VisionJudgment = {
  // 2 = the whole request, 1 = right subject but missing part of it
  // (setting, pose, lighting), 0 = wrong subject. A yes/no answer was too
  // strict: it rejected every Rembrandt for "side profile dramatic
  // lighting" (right subject, wrong pose) and left pages at 6-8 results.
  match: 0 | 1 | 2;
  lighting: LightingProfile;
  // From lighting, by lightingScoreFor(). Same scale as
  // ArtworkResult.lightingScore.
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
    `This result is titled "${result.title}" (${result.source}). The title is only a hint ` +
    `to what the image shows; judge everything from the image itself.\n` +
    `Reply with ONLY JSON:\n` +
    `{"match": 0|1|2, "light": {"sources": 1|2|3, "quality": "hard"|"soft", "direction": ` +
    `${DIRECTIONS.map((d) => `"${d}"`).join("|")}, "shadow": 0|1|2|3, "type": "..."}, ` +
    `"categories": [...]}\n` +
    `- match: how well this image serves as a reference for the search. 2 = right subject and ` +
    `everything else the search asks for (action, setting, lighting, pose). 1 = right subject ` +
    `but missing or different on some of the rest. 0 = wrong subject: a 3D object, textile, or ` +
    `unrelated thing that only shares a word with the search. Also 0 when the thing the ` +
    `search names (a face, hands, a pose) can't be studied in the image: mostly covered by ` +
    `hands, hair or objects, turned away, or cropped out. Shadow falling across a visible ` +
    `face is fine.\n` +
    `- light: describe only the light falling ON THE MAIN SUBJECT (the face, figure or ` +
    `thing the search is about), not the background. A dark or black background says ` +
    `nothing about the light on the subject.\n` +
    `  - sources: how many distinct lights fall on the subject. 1 = one isolated source ` +
    `(a single lamp, candle, window or spotlight); 2 = two (e.g. key and fill); 3 = three ` +
    `or more, or ambient light with no clear source.\n` +
    `  - quality: "hard" = crisp shadow edges, a sharp line between lit and dark; "soft" = ` +
    `gradual, blended shadows.\n` +
    `  - direction: where the main light comes from, relative to the subject. "ambient" ` +
    `if there's no clear direction.\n` +
    `  - shadow: how much of the subject itself falls into deep shadow: 0 = none, evenly ` +
    `lit; 1 = a little (under the chin, eye sockets); 2 = about a third; 3 = half or more.\n` +
    `  - type: the one best fit from ${JSON.stringify(LIGHTING_TYPES)}. Glowing or ` +
    `reflective paint, makeup or jewelry is not a light source.\n` +
    `- categories: 1-${MAX_CATEGORIES} of ${JSON.stringify(MATCH_REASON_CATEGORIES)} that this ` +
    `image is most useful for as a reference.`
  );
}

function parseLighting(raw: unknown): LightingProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const light = raw as Record<string, unknown>;

  const sources = Number(light.sources);
  const shadow = Number(light.shadow);
  const quality = light.quality;
  const direction = DIRECTIONS.find((value) => value === light.direction);
  const type = LIGHTING_TYPES.find((value) => value === light.type);
  if (![1, 2, 3].includes(sources) || ![0, 1, 2, 3].includes(shadow)) return null;
  if ((quality !== "hard" && quality !== "soft") || !direction || !type) return null;

  return {
    sources: sources as LightingProfile["sources"],
    quality,
    direction,
    shadow: shadow as LightingProfile["shadow"],
    type
  };
}

function parseJudgment(raw: string): VisionJudgment | null {
  try {
    const parsed = JSON.parse(raw) as { match?: unknown; light?: unknown; categories?: unknown };
    const match = Number(parsed.match);
    const lighting = parseLighting(parsed.light);
    if (![0, 1, 2].includes(match) || !lighting) return null;

    const categories = (Array.isArray(parsed.categories) ? parsed.categories : [])
      .map((value) => MATCH_REASON_CATEGORIES.find((category) => category === value))
      .filter((category): category is MatchReasonCategory => Boolean(category));

    return {
      match: match as VisionJudgment["match"],
      lighting,
      lightingScore: lightingScoreFor(lighting),
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
      const cacheKey = `${PROMPT_VERSION}|${normalizedQuery}|${result.id}`;
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
