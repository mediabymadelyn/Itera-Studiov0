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
// Direction is judged from the subject's point of view, not the camera's
// (the user's call): a profile face turned toward the light is front-lit.
//
// Uses the Gemini API directly (not the Hugging Face router) for JSON
// output and the image-detail setting.

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_VISION_MODEL = "gemini-3.8-flash";
// The slowest image in a search sets how long the step takes; in testing
// the slowest of 40 took ~6s at medium detail.
const JUDGE_TIMEOUT_MS = 8000;
const IMAGE_SIZE = 512;
const MEDIA_RESOLUTION = "MEDIA_RESOLUTION_MEDIUM";
const THINKING_LEVEL = "low";
const MAX_CATEGORIES = 3;

const JUDGMENT_CACHE_MAX_SIZE = 2000;
// Part of the cache key, so judgments made under an earlier prompt or
// scoring rule aren't reused. Bump when buildPrompt or lightingScoreFor
// changes.
const PROMPT_VERSION = 10;

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
  // How sharply the lit part of the subject separates from darkness on or
  // right around it. "high" = light falling off quickly into near-black: an
  // isolated light. A dark background behind an evenly lit subject is not.
  contrast: "low" | "medium" | "high";
  // Can a viewer still make out the subject's form and features?
  readable: "yes" | "partly" | "no";
};

const DIRECTIONS: LightingProfile["direction"][] = ["front", "side", "back", "top", "below", "ambient"];
const CONTRASTS: LightingProfile["contrast"][] = ["low", "medium", "high"];
const READABILITY: LightingProfile["readable"][] = ["yes", "partly", "no"];
// Types that can't be dramatic however the other parts read: light spread
// evenly over the subject, broken into stripes and dapples, or (the user's
// call) a silhouette, which shows no light falling on the form at all.
const FLAT_TYPES: LightingType[] = ["even / flat", "high-key"];
const CAPPED_TYPES: LightingType[] = ["dappled / patterned", "silhouette"];
const FLAT_TYPE_MAX_SCORE = 1;
const NOT_DRAMATIC_MAX_SCORE = 3;
const UNREADABLE_MAX_SCORE = 2;
const DRAMATIC_SCORE = 4;

// How much of the subject must be in deep shadow (0-3) for the light to
// count as dramatic: half or more, or a third when the light is isolated
// (high contrast). Set against the eval set's yes/no verdicts
// (data/eval/): hard single-source light leaving a third of the figure in
// shadow against darkness (Manfredi's "Cupid Chastised", Zurbaran's
// "Crucifixion") is dramatic; the same third under open light (sun rays on
// a face, a softly lit museum portrait) is not.
const DRAMATIC_MIN_SHADOW = 3;
const ISOLATED_MIN_SHADOW = 2;

/**
 * The 0-5 lighting score, from the parts the model described: shadow on
 * the subject (0-3), +1 for a single isolated source, +1 for hard light,
 * then these limits, checked against the eval set (50/52 of its verdicts):
 * - Dramatic (4+) needs half the subject in shadow, or a third when the
 *   light is isolated (high contrast).
 * - Even / high-key light: at most 1. Dappled light and silhouettes: at
 *   most 3. Backlight that isn't a rim light: at most 3 (the shadow is just
 *   the subject's unlit front, as in a hazy backlit seascape).
 * - Partly readable: one point off; unreadable: at most 2. A dramatic image
 *   no one can make out is no use as a reference.
 * - Colored light with high contrast counts as dramatic (4) even with
 *   little shadow: it's dramatic through color (red/blue split light, a
 *   green face lit from below).
 * - Paintings and prints (`painted`) get the hard-light point when the light
 *   is isolated: paint rarely shows crisp shadow edges, so the model calls
 *   most chiaroscuro "soft". On the eval set this caught La Tour's
 *   Magdalen and Rembrandt's Aristotle (missed dramatic paintings 8 -> 2),
 *   at the cost of passing a few softly lit ones (wrongly dramatic 10 -> 16;
 *   overall agreement unchanged at 84%).
 */
export function lightingScoreFor(profile: LightingProfile, options: { painted?: boolean } = {}): number {
  const { shadow, contrast, type, readable } = profile;
  const hard = profile.quality === "hard" || (options.painted === true && contrast === "high");
  let score = shadow + (profile.sources === 1 ? 1 : 0) + (hard ? 1 : 0);

  const enoughShadow = shadow >= DRAMATIC_MIN_SHADOW || (shadow >= ISOLATED_MIN_SHADOW && contrast === "high");
  if (!enoughShadow) score = Math.min(score, NOT_DRAMATIC_MAX_SCORE);
  if (FLAT_TYPES.includes(type)) score = Math.min(score, FLAT_TYPE_MAX_SCORE);
  if (CAPPED_TYPES.includes(type)) score = Math.min(score, NOT_DRAMATIC_MAX_SCORE);
  if (profile.direction === "back" && type !== "rim / back") score = Math.min(score, NOT_DRAMATIC_MAX_SCORE);

  if (readable === "partly") score -= 1;
  if (readable === "no") score = Math.min(score, UNREADABLE_MAX_SCORE);
  else if (type === "colored / neon" && contrast === "high" && shadow >= 1) score = Math.max(score, DRAMATIC_SCORE);

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
  // The palette, as the model sees it. Pixel measures couldn't do this: on
  // the eval set's paintings a hue-based warm/cool rule got 20/35 against
  // the labels, barely above calling everything warm (19/35), because
  // varnish and museum photography cast nearly every painting warm. Absent
  // if the model left it out.
  color?: ColorJudgment;
};

export type ColorJudgment = {
  temperature: "warm" | "cool" | "neutral" | "mixed";
  saturation: "vivid" | "muted" | "black and white";
};
const TEMPERATURES: ColorJudgment["temperature"][] = ["warm", "cool", "neutral", "mixed"];
const SATURATIONS: ColorJudgment["saturation"][] = ["vivid", "muted", "black and white"];

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
    `${DIRECTIONS.map((d) => `"${d}"`).join("|")}, "shadow": 0|1|2|3, "type": "...", ` +
    `"contrast": "low"|"medium"|"high", "readable": "yes"|"partly"|"no"}, ` +
    `"color": {"temperature": "warm"|"cool"|"neutral"|"mixed", "saturation": "vivid"|"muted"|"black and white"}, ` +
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
    `  - direction: where the main light comes from, from the subject's own point of view, ` +
    `not the camera's: "front" = the light hits the side the subject is facing (a face in ` +
    `profile turned toward the light is front-lit), "side" = from the subject's left or ` +
    `right, "back" = from behind the subject, "top" / "below" = from above / below. ` +
    `"ambient" if there's no clear direction.\n` +
    `  - shadow: how much of the subject itself falls into deep shadow: 0 = none, evenly ` +
    `lit; 1 = a little (under the chin, eye sockets); 2 = about a third; 3 = half or more.\n` +
    `  - type: the one best fit from ${JSON.stringify(LIGHTING_TYPES)}. Glowing or ` +
    `reflective paint, makeup or jewelry is not a light source.\n` +
    `  - contrast: how sharply the lit part of the subject separates from darkness on the ` +
    `subject or right next to it. "high" = the light falls off quickly into near-black, as ` +
    `if only the subject were lit; "medium" = clear light and shadow but open, lit ` +
    `surroundings; "low" = little difference. An evenly lit subject in front of a black ` +
    `background is "low" or "medium", not "high".\n` +
    `  - readable: can a viewer still make out the subject's form and features? "partly" ` +
    `if they're hard to make out (very dark, tiny, or lost in shadow); "no" if they can't ` +
    `be made out at all.\n` +
    `- color: the image's own palette as painted or photographed. A uniform yellow varnish, aged ` +
    `paper or an old photo's tint does not make an image warm.\n` +
    `  - temperature: the temperature that covers most of the image. "warm" = saturated reds, ` +
    `oranges or golden light dominate; "cool" = blues, greens or grey-blue light dominate; ` +
    `"neutral" = mostly greys, browns, blacks and dull earth tones, even if slightly warm; ` +
    `"mixed" only when ` +
    `large warm and large cool areas share the image about equally. Small accents of the other ` +
    `temperature (a blue sash, a patch of sky) don't make it mixed.\n` +
    `  - saturation: "vivid" = strong, saturated color; "muted" = soft, greyed or earthy color; ` +
    `"black and white" = monochrome, including sepia and toned prints.\n` +
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
  const contrast = CONTRASTS.find((value) => value === light.contrast);
  const readable = READABILITY.find((value) => value === light.readable);
  if (![1, 2, 3].includes(sources) || ![0, 1, 2, 3].includes(shadow)) return null;
  if ((quality !== "hard" && quality !== "soft") || !direction || !type || !contrast || !readable) return null;

  return {
    sources: sources as LightingProfile["sources"],
    quality,
    direction,
    shadow: shadow as LightingProfile["shadow"],
    type,
    contrast,
    readable
  };
}

/** Museum works other than photographs: scored with the painting rule. */
export function isPaintedResult(result: Pick<ArtworkResult, "source" | "classification">): boolean {
  return !result.source.toLowerCase().includes("unsplash") && !/photograph/i.test(result.classification ?? "");
}

function parseColor(raw: unknown): ColorJudgment | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const color = raw as Record<string, unknown>;
  const temperature = TEMPERATURES.find((value) => value === color.temperature);
  const saturation = SATURATIONS.find((value) => value === color.saturation);
  return temperature && saturation ? { temperature, saturation } : undefined;
}

function parseJudgment(raw: string, painted: boolean): VisionJudgment | null {
  try {
    const parsed = JSON.parse(raw) as { match?: unknown; light?: unknown; color?: unknown; categories?: unknown };
    const match = Number(parsed.match);
    const lighting = parseLighting(parsed.light);
    if (![0, 1, 2].includes(match) || !lighting) return null;

    const categories = (Array.isArray(parsed.categories) ? parsed.categories : [])
      .map((value) => MATCH_REASON_CATEGORIES.find((category) => category === value))
      .filter((category): category is MatchReasonCategory => Boolean(category));

    return {
      match: match as VisionJudgment["match"],
      lighting,
      lightingScore: lightingScoreFor(lighting, { painted }),
      categories: Array.from(new Set(categories)).slice(0, MAX_CATEGORIES),
      color: parseColor(parsed.color)
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
          mediaResolution: MEDIA_RESOLUTION,
          temperature: 0,
          thinkingConfig: { thinkingLevel: THINKING_LEVEL }
        }
      }),
      signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS)
    });
    if (!response.ok) return null;

    const data = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    return parseJudgment(text, isPaintedResult(result));
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

/** The settings judgments are made under; eval runs record these. */
export function visionJudgeSettings() {
  return {
    model: visionModel(),
    promptVersion: PROMPT_VERSION,
    imageSize: IMAGE_SIZE,
    mediaResolution: MEDIA_RESOLUTION,
    thinkingLevel: THINKING_LEVEL,
    timeoutMs: JUDGE_TIMEOUT_MS
  };
}

/**
 * Forgets every cached judgment. Only for the eval (scripts/eval), which
 * judges each image several times to measure how consistent the model is.
 */
export function clearJudgmentCache(): void {
  judgmentCache.clear();
}
