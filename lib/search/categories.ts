// Closed vocabulary for match-reason labels, shared by the LLM labeling
// step (llmQueryLayer.ts) and the filter row in the UI, which always shows
// every category in this order so filters stay in fixed positions (P4, P5,
// P6). Each name is a dimension of reference usefulness, not a subject
// description, so the model can't satisfy it by just restating what's in
// the image.
export const MATCH_REASON_CATEGORIES = [
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

export type MatchReasonCategory = (typeof MATCH_REASON_CATEGORIES)[number];
