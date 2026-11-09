/**
 * Shared shape and allowed values for the lighting & composition eval
 * manifest (data/eval/itera_eval_manifest.json). Used by every eval script.
 *
 * The allowed values mirror what the app's vision judge can return
 * (lib/search/visionJudge.ts, lib/search/categories.ts). run-eval.mts checks
 * at startup that they still match, so a renamed type can't silently skew
 * the agreement numbers.
 */
import { readFileSync } from "node:fs";

export const MANIFEST_PATH = "data/eval/itera_eval_manifest.json";
export const PROVENANCE_PATH = "data/eval/provenance_report.json";

export const SOURCES = ["Met", "AIC", "Unsplash"] as const;
export const YES_PARTLY_NO = ["yes", "partly", "no"] as const;
// The judge only distinguishes 1, 2 and "3 or more / ambient" (its 3), so
// "3+" and "ambient" both count as 3 when comparing.
export const LIGHT_SOURCES = ["1", "2", "3+", "ambient"] as const;
export const QUALITIES = ["hard", "soft"] as const;
export const DIRECTIONS = ["front", "side", "back", "top", "below", "ambient"] as const;
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
export const CATEGORIES = [
  "Pose/Anatomy",
  "Lighting",
  "Color Palette",
  "Composition",
  "Style/Technique",
  "Texture/Material",
  "Expression/Emotion",
  "Environment/Setting",
  "Historical/Cultural Reference"
] as const;
export const CONFIDENCE = ["high", "medium", "low"] as const;
export const CONTRASTS = ["low", "medium", "high"] as const;
export const YES_NO = ["yes", "no"] as const;
// Who gave the dramatic verdict: "maddi" for reviewed labels, "claude" for
// proposed ones still waiting on review.
export const LABELERS = ["maddi", "claude"] as const;

export type ManifestLabels = {
  subject_visible: (typeof YES_PARTLY_NO)[number];
  readable: (typeof YES_PARTLY_NO)[number];
  sources: (typeof LIGHT_SOURCES)[number];
  quality: (typeof QUALITIES)[number];
  direction: (typeof DIRECTIONS)[number];
  shadow: 0 | 1 | 2 | 3;
  type: (typeof LIGHTING_TYPES)[number];
  // A direct verdict: is this dramatic lighting, by Maddi's definition (one
  // isolated light on the subject, real shadow on the subject itself, still
  // readable)? Tests the scoring rule, not just the parts.
  dramatic: (typeof YES_NO)[number];
  dramatic_confidence: (typeof CONFIDENCE)[number];
  dramatic_by: (typeof LABELERS)[number];
  // Proposed fields the judge doesn't return yet; kept, not scored.
  pattern_proposed: string;
  color_temp: string;
  // Also judged by the model since prompt v6 (with readable): feeds the
  // isolated-light part of the scoring rule.
  contrast: (typeof CONTRASTS)[number];
  categories: (typeof CATEGORIES)[number][];
};

export type ManifestRow = {
  id: string;
  source: (typeof SOURCES)[number];
  object_id: string;
  title: string;
  artist: string;
  date: string;
  test_group: string;
  test_query: string;
  labels: ManifestLabels;
  composition: string;
  confidence: (typeof CONFIDENCE)[number];
  page_url: string;
  api_url: string;
  rights_expected: string;
  eval_allowed: boolean;
  eval_blocker: string | null;
  review_status: string;
};

export type ProvenanceRow = {
  id: string;
  source: ManifestRow["source"];
  object_id: string;
  checked_at: string;
  checks: {
    exists: boolean;
    public_domain: boolean | null;
    has_image: boolean;
    title_match: number | null;
  };
  api_title: string | null;
  // The image the app itself would show and judge: the Met's own image, or
  // for AIC the Wikimedia Commons copy (AIC's image host blocks apps).
  image_url: string | null;
  thumbnail_url: string | null;
  credit_line: string | null;
  // The museum's own type for the work ("Paintings", "Photographs",
  // "Print"...): decides whether the painting rule applies.
  classification: string | null;
  // Manifest eligibility AND every check passing.
  eval_allowed: boolean;
  reasons: string[];
};

export function loadManifest(): ManifestRow[] {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as ManifestRow[];
}

export function loadProvenance(): ProvenanceRow[] {
  return JSON.parse(readFileSync(PROVENANCE_PATH, "utf8")) as ProvenanceRow[];
}

/** "3+" and "ambient" are both the judge's 3. */
export function judgeSourceCount(value: ManifestLabels["sources"]): 1 | 2 | 3 {
  return value === "1" ? 1 : value === "2" ? 2 : 3;
}
