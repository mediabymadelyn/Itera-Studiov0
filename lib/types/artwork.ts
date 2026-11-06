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
  // The creator's own profile page, when the source has one (Unsplash
  // photographers). Unsplash's API guidelines require linking it.
  artistLink?: string;
  // Unsplash's download-tracking endpoint for the photo. The guidelines
  // require calling it when a user picks a photo to use; for Itera that's
  // opening it as a reference or clicking through to the original (see
  // components/unsplashDownload.ts and app/api/unsplash/download).
  downloadLocation?: string;
  // Width / height of the image, when the source says so up front (Unsplash
  // does). Lets the grid size each card before its image loads; other
  // sources are sized once the image arrives.
  imageAspectRatio?: number;
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
  // 0-1 hint of how well-regarded the image is at its source (Unsplash
  // likes, the Met's highlight flag). Kept as a small ranking nudge only --
  // weighting it heavily would amplify the sources' existing skews.
  qualitySignal?: number;
  // Which search found this result (see searchAll.ts). "diversity" results
  // come from the people-background Unsplash variant or the Met's
  // non-Western departments, and get a couple of reserved slots.
  // "lighting" results come from a museum search for the light itself
  // ("candlelight"), not the subject; see queryPlan.ts.
  retrievedVia?: "primary" | "secondary" | "diversity" | "lighting";
  // 1-3 reference categories, strongest first (e.g. "Pose/Anatomy",
  // "Lighting"). Only set by the LLM rerank layer, which is judging
  // per-candidate relevance anyway -- there's no honest source for these
  // labels on the plain keyword/mechanical selection path, so they're
  // simply absent there.
  matchReasons?: string[];
  // Strength of the lighting as judged by the vision model (0-5). Used to
  // order results within the Lighting filter and for lighting queries.
  lightingScore?: number;
  // The kind of light on the subject ("side / split", "soft window", ...),
  // from the vision model's lighting breakdown (see visionJudge.ts).
  lightingType?: string;
  // How well the image matches the whole request, judged by the vision
  // model from the image itself (see lib/search/visionJudge.ts): 2 = all
  // of it, 1 = right subject but missing part. Absent when not judged.
  visionMatch?: 1 | 2;
  // Wikidata item for the work, when the source links one (the Met does).
  // Used to look up its art movement (see lib/search/lightingCatalog.ts).
  wikidataId?: string;
  // True when Wikidata ties the work to dramatic light: painted by an
  // artist known for it, or tagged tenebrism / Caravaggisti.
  knownForDramaticLight?: boolean;
  // Pixel measurements of the thumbnail (see lib/search/imageAnalysis.ts).
  imageMetrics?: {
    contrast: number;
    darkShare: number;
    brightShare: number;
    drama: number;
    sharpness: number;
  };
  // True on the single best result that meets every part of the request
  // (see chooseTopPick in searchAll.ts). Only ever set on the LLM rerank
  // path, same as matchReasons, and absent when nothing qualifies.
  isTopPick?: boolean;
  // Not part of the main results: picked only to give an otherwise-empty
  // category something to show (see benchEmptyCategories in
  // llmQueryLayer.ts). The UI shows these only under that category's filter.
  benchOnly?: boolean;
};
