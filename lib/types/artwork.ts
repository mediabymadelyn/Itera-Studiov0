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
};
