import { ArtworkResult, VisualTags } from "@/lib/types/artwork";
import { describeVisualTags, isVisualSearchEnabled } from "@/lib/search/visualTags";

// Query phrases mapped to the structured tag values they should match.
// Deliberately small and literal, in the same spirit as the keyword lists
// in lib/search/routeQuery.ts. Sourced from the queries validated in
// docs/blip-caption-eval.md.
const LIGHTING_TERM_SYNONYMS: Record<string, string[]> = {
  "golden hour": ["back", "side-left", "side-right", "soft"],
  backlit: ["back"],
  backlighting: ["back"],
  "rim light": ["back"],
  "rim lighting": ["back"],
  silhouette: ["back", "hard", "high"],
  chiaroscuro: ["hard", "high"],
  "dramatic light": ["hard", "high"],
  "dramatic lighting": ["hard", "high"],
  "low key": ["hard", "high"],
  "high key": ["soft", "low"],
  overcast: ["diffuse", "flat", "low"],
  "flat light": ["diffuse", "flat"],
  "soft light": ["soft"],
  "diffused light": ["diffuse", "soft"],
  "diffuse light": ["diffuse", "soft"],
  "hard light": ["hard", "high"],
  "harsh light": ["hard", "high"],
  "harsh shadows": ["hard", "high"],
  "side light": ["side-left", "side-right"],
  "front light": ["front"],
  "top light": ["above"],
  "top lighting": ["above"],
  "overhead light": ["above"],
  "overhead lighting": ["above"],
  "light from above": ["above"],
  "light from below": ["below"],
  "window light": ["soft", "diffuse"]
};

const COMPOSITION_TERM_SYNONYMS: Record<string, string[]> = {
  diagonal: ["diagonal"],
  symmetrical: ["symmetrical", "centered"],
  centered: ["centered"],
  "rule of thirds": ["rule of thirds"],
  "close-up": ["close-up", "tight framing"],
  "close up": ["close-up", "tight framing"],
  "wide angle": ["wide angle", "wide framing"],
  "low horizon": ["low horizon"],
  "leading lines": ["leading lines"]
};

// docs/blip-caption-eval.md: lighting_direction is only trusted when the
// model didn't say "unclear" and its own confidence clears this bar.
const LIGHTING_MATCH_MIN_CONFIDENCE = 0.6;
const VISUAL_MATCH_WEIGHT = 0.15;

// Longest phrase first so e.g. "overhead lighting" is stripped whole
// rather than leaving a stray "lighting" behind after a shorter match.
const DESCRIPTOR_PHRASES = [
  ...Object.keys(LIGHTING_TERM_SYNONYMS),
  ...Object.keys(COMPOSITION_TERM_SYNONYMS)
].sort((a, b) => b.length - a.length);

/**
 * Strips recognized lighting/composition descriptor phrases out of a query,
 * leaving only the subject terms to send to source search APIs (their
 * full-text search matches title/tag metadata, which essentially never
 * contains phrases like "overhead lighting"). The full original query is
 * still used for ranking and for this module's own visual tag boost.
 */
export function extractSubjectQuery(query: string): string {
  const normalizedQuery = query.toLowerCase();

  const stripped = DESCRIPTOR_PHRASES.reduce(
    (text, phrase) => text.split(phrase).join(" "),
    normalizedQuery
  );

  const subjectQuery = stripped.replace(/\s+/g, " ").trim();

  return subjectQuery.length > 0 ? subjectQuery : query;
}

function scoreVisualTagMatch(query: string, tags: VisualTags): number {
  const normalizedQuery = query.toLowerCase();
  let score = 0;

  const lightingTrusted =
    tags.lightingDirection !== "unclear" &&
    (tags.confidence ?? 0) >= LIGHTING_MATCH_MIN_CONFIDENCE;

  if (lightingTrusted) {
    for (const [phrase, targets] of Object.entries(LIGHTING_TERM_SYNONYMS)) {
      if (!normalizedQuery.includes(phrase)) continue;

      if (
        targets.includes(tags.lightingDirection) ||
        targets.includes(tags.lightingQuality) ||
        targets.includes(tags.contrast)
      ) {
        score += 1;
      }
    }
  }

  const compositionText = tags.composition.join(" ");
  for (const [phrase, targets] of Object.entries(COMPOSITION_TERM_SYNONYMS)) {
    if (!normalizedQuery.includes(phrase)) continue;

    if (targets.some((target) => compositionText.includes(target))) {
      score += 1;
    }
  }

  for (const moodWord of tags.mood) {
    if (moodWord.length >= 3 && normalizedQuery.includes(moodWord)) {
      score += 1;
    }
  }

  return score;
}

/**
 * Re-scores an already-ranked, already-sliced result set using visual
 * treatment tags (lighting/mood/composition), then re-sorts by the combined
 * score. Only reorders the results it's given -- it cannot pull in a
 * candidate that didn't already make the cut, since only the final top N
 * are tagged (cost/latency control). A no-op unless ENABLE_VISUAL_SEARCH=true
 * and an API key is configured; tagging failures leave a result's score
 * untouched rather than breaking search.
 */
export async function applyVisualTagBoost(
  results: ArtworkResult[],
  query: string
): Promise<ArtworkResult[]> {
  if (!isVisualSearchEnabled() || results.length === 0) {
    return results;
  }

  const tagged = await Promise.all(
    results.map(async (result) => {
      const visualTags = await describeVisualTags(result.imageUrl);

      if (!visualTags) {
        return result;
      }

      const boost = scoreVisualTagMatch(query, visualTags) * VISUAL_MATCH_WEIGHT;

      return {
        ...result,
        visualTags,
        score: Number(((result.score ?? 0) + boost).toFixed(4))
      };
    })
  );

  return tagged.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
