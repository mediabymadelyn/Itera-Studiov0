import { ArtworkResult } from "@/lib/types/artwork";

type AicSearchResponse = {
  data?: AicSearchItem[];
};

type AicSearchItem = {
  id: number;
  title?: string;
  artist_display?: string;
  image_id?: string;
  is_public_domain?: boolean;
};

const AIC_SEARCH_URL = "https://api.artic.edu/api/v1/artworks/search";

function buildAicImageUrl(imageId: string): string {
  return `https://www.artic.edu/iiif/2/${imageId}/full/843,/0/default.jpg`;
}

function normalizeAicItem(item: AicSearchItem, index: number): ArtworkResult | null {
  if (!item.image_id) {
    return null;
  }

  const imageUrl = buildAicImageUrl(item.image_id);

  return {
    id: `aic-${item.id}`,
    title: item.title || "Untitled",
    artist: item.artist_display || "Unknown artist",
    source: "Art Institute of Chicago",
    imageUrl,
    originalLink: `https://www.artic.edu/artworks/${item.id}`,
    thumbnailUrl: imageUrl,
    licenseType: item.is_public_domain ? "Public Domain" : "Unknown",
    sourceLink: "https://www.artic.edu",
    score: Math.max(0, 1 - index * 0.01)
  };
}

export async function searchAicArtworks(
  query: string,
  limit = 6
): Promise<ArtworkResult[]> {
  const searchParams = new URLSearchParams({
    q: query,
    fields: "id,title,artist_display,image_id,is_public_domain",
    limit: "18",
    page: "1"
  });

  const response = await fetch(`${AIC_SEARCH_URL}?${searchParams.toString()}`, {
    next: { revalidate: 300 }
  });

  if (!response.ok) {
    throw new Error("Failed to search the AIC API.");
  }

  const data = (await response.json()) as AicSearchResponse;

  return (data.data ?? [])
    .map((item, index) => normalizeAicItem(item, index))
    .filter((result): result is ArtworkResult => result !== null)
    .slice(0, limit);
}
