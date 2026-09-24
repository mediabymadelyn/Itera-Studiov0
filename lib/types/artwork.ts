export type VisualTags = {
  lightingDirection: string;
  lightingQuality: string;
  contrast: string;
  mood: string[];
  composition: string[];
  confidence: number | null;
};

export type ArtworkResult = {
  id: string;
  title: string;
  artist: string;
  source: string;
  imageUrl: string;
  originalLink: string;
  thumbnailUrl?: string;
  licenseType?: string;
  sourceLink?: string;
  score?: number;
  visualTags?: VisualTags;
  subjectTitles?: string[];
  styleTitles?: string[];
  techniqueTitles?: string[];
  themeTitles?: string[];
  description?: string;
  shortDescription?: string;
  tags?: string[];
  medium?: string;
  classification?: string;
  culture?: string;
  objectDate?: string;
  // Short, human-readable reason this result matched the query (e.g. "pose
  // reference", "lighting reference"). Only set by the LLM rerank layer,
  // which is judging per-candidate relevance anyway -- there's no honest
  // source for this label on the plain keyword/mechanical selection path,
  // so it's simply absent there.
  matchReason?: string;
  // True on the single result the LLM rerank layer ranked first (its own
  // "ordered best match first" output) -- reuses the existing ranking
  // rather than a separate judgment call, so it's only ever set on the
  // LLM rerank path, same as matchReason.
  isTopPick?: boolean;
};
