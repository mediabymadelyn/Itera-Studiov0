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
};
