import { ArtworkResult } from "@/lib/types/artwork";

// Closed vocabulary for match-reason labels, shared by the labeling step
// (the vision judge; llmQueryLayer.ts on the fallback path) and the filter
// row in the UI, which always shows every category in this order so
// filters stay in fixed positions (P4, P5, P6). Each name is a dimension of
// reference usefulness, not a subject description, so the model can't
// satisfy it by just restating what's in the image. "Historical/Cultural
// Reference" and "Style/Technique" were dropped: they applied mostly to
// museum works, repeating the "Museum art" filter, and were the categories
// most often empty.
export const MATCH_REASON_CATEGORIES = [
  "Pose/Anatomy",
  "Lighting",
  "Color Palette",
  "Composition",
  "Expression/Emotion",
  "Environment/Setting",
  "Texture/Material"
] as const;

export type MatchReasonCategory = (typeof MATCH_REASON_CATEGORIES)[number];

// The model sees the full names, which say more; the UI shows these.
export const CATEGORY_LABELS: Record<MatchReasonCategory, string> = {
  "Pose/Anatomy": "Pose",
  Lighting: "Lighting",
  "Color Palette": "Color",
  Composition: "Composition",
  "Expression/Emotion": "Expression",
  "Environment/Setting": "Setting",
  "Texture/Material": "Texture"
};

// --- Sub-tags ---------------------------------------------------------------
// Shown under a category once it's selected, in this fixed order. Each one
// filters the whole page by a property of the image, not just the results
// labeled with the category, so "Black & white" finds every black-and-white
// result. Only categories with a measured source have sub-tags so far:
// Lighting (the vision judge's lighting parts) and Color (pixel measures).

export const LIGHTING_SUBTAGS = [
  "Side / split",
  "Rim / back",
  "Under / top",
  "Single light source",
  "Colored",
  "Soft light"
] as const;

// Worked out from the lighting parts rather than the judge's single
// "type", so an image can carry several (side light that's also a single
// isolated source) and the tags follow the same parts as the dramatic
// score. The type alone matched the eval labels 78% of the time and forced
// mixed light into one bucket.
export function lightingSubtagsOf(result: ArtworkResult): string[] {
  const light = result.lighting;
  if (!light) return [];

  const tags: string[] = [];
  if (light.direction === "side") tags.push("Side / split");
  if (light.direction === "back" || light.type === "rim / back") tags.push("Rim / back");
  if (light.direction === "top" || light.direction === "below" || light.type === "under / top") tags.push("Under / top");
  if (light.sources === 1 && light.contrast === "high") tags.push("Single light source");
  if (light.type === "colored / neon") tags.push("Colored");
  // Broad, gentle light from one side (a window, an overcast sky): soft,
  // with some modeling shadow, but not isolated and not flat.
  if (
    light.quality === "soft" &&
    light.shadow >= 1 &&
    light.shadow <= 2 &&
    light.contrast !== "high" &&
    light.direction !== "ambient" &&
    light.type !== "even / flat" &&
    light.type !== "high-key"
  ) {
    tags.push("Soft light");
  }
  return tags;
}

// Temperature tags only show when one temperature dominates. Against the
// eval labels (data/eval/), when shown: Warm right 89%, Cool 67%, Neutral
// 67%; the model's "mixed" was right 16% of the time, so mixed images get
// no temperature tag rather than a "Mixed" one.
export const COLOR_SUBTAGS = ["Warm", "Cool", "Neutral", "Vivid", "Muted", "Black & white"] as const;

// Below this pixel colorfulness an image is grey -- black and white even if
// the model missed it. Grey photos measure 0-3; dark, warm paintings (La
// Tour's candlelit Magdalen) and sepia or etched prints ~10-18. Also caps
// black-and-white results in Best matches (searchAll.ts).
export const MONOCHROME_COLORFULNESS = 6;

const TEMPERATURE_TAGS: Partial<Record<string, string>> = { warm: "Warm", cool: "Cool", neutral: "Neutral" };
const SATURATION_TAGS = { vivid: "Vivid", muted: "Muted" } as const;

export const SUBTAGS: Partial<Record<MatchReasonCategory, readonly string[]>> = {
  Lighting: LIGHTING_SUBTAGS,
  "Color Palette": COLOR_SUBTAGS
};

// From the vision judge's palette read (temperature, saturation), which
// knows varnish isn't warmth; grey pixels also count as black and white.
export function colorSubtagsOf(result: ArtworkResult): string[] {
  const grey = result.imageMetrics !== undefined && result.imageMetrics.colorfulness < MONOCHROME_COLORFULNESS;
  if (grey || result.color?.saturation === "black and white") return ["Black & white"];
  if (!result.color) return [];
  return [TEMPERATURE_TAGS[result.color.temperature], SATURATION_TAGS[result.color.saturation]].filter(
    (tag): tag is string => Boolean(tag)
  );
}

export function subtagsOf(result: ArtworkResult, category: MatchReasonCategory): string[] {
  if (category === "Lighting") return lightingSubtagsOf(result);
  if (category === "Color Palette") return colorSubtagsOf(result);
  return [];
}
