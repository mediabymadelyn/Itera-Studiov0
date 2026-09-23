import { ArtworkResult } from "@/lib/types/artwork";
import { fetchAicCommonsImages } from "@/lib/sources/wikidataAicImages";

type AicSearchResponse = {
  data?: AicSearchItem[];
};

type AicSearchItem = {
  id: number;
  title?: string;
  artist_display?: string;
  main_reference_number?: string;
  is_public_domain?: boolean;
  subject_titles?: string[];
  style_titles?: string[];
  technique_titles?: string[];
  theme_titles?: string[];
  description?: string;
  short_description?: string;
};

const AIC_SEARCH_URL = "https://api.artic.edu/api/v1/artworks/search";

function normalizeAicItem(
  item: AicSearchItem,
  index: number,
  commonsImagesByReference: Map<string, string>
): ArtworkResult | null {
  const commonsImage = item.main_reference_number
    ? commonsImagesByReference.get(item.main_reference_number)
    : undefined;

  // AIC's own IIIF host (www.artic.edu/iiif) currently blocks every
  // hotlinked image request, so a result is only worth returning if we
  // found a working Wikimedia Commons copy for it. Falling back to AIC's
  // own (dead) URL just returns a card that's guaranteed to be dropped
  // client-side once its image fails, wasting a result slot -- so skip it
  // entirely instead, same as if it had no image at all.
  if (!commonsImage) {
    return null;
  }

  const imageUrl = `${commonsImage}?width=843`;
  const thumbnailUrl = `${commonsImage}?width=400`;

  return {
    id: `aic-${item.id}`,
    title: item.title || "Untitled",
    artist: item.artist_display || "Unknown artist",
    source: "Art Institute of Chicago",
    imageUrl,
    originalLink: `https://www.artic.edu/artworks/${item.id}`,
    thumbnailUrl,
    licenseType: item.is_public_domain ? "Public Domain" : "Unknown",
    sourceLink: "https://www.artic.edu",
    score: Math.max(0, 1 - index * 0.01),
    subjectTitles: item.subject_titles,
    styleTitles: item.style_titles,
    techniqueTitles: item.technique_titles,
    themeTitles: item.theme_titles,
    description: item.description,
    shortDescription: item.short_description
  };
}

export async function searchAicArtworks(
  query: string,
  limit = 6,
  signal?: AbortSignal
): Promise<ArtworkResult[]> {
  const searchParams = new URLSearchParams({
    q: query,
    fields:
      "id,title,artist_display,main_reference_number,is_public_domain,subject_titles,style_titles,technique_titles,theme_titles,description,short_description",
    limit: "18",
    page: "1"
  });

  const response = await fetch(`${AIC_SEARCH_URL}?${searchParams.toString()}`, {
    signal,
    next: { revalidate: 300 }
  });

  if (!response.ok) {
    throw new Error("Failed to search the AIC API.");
  }

  const data = (await response.json()) as AicSearchResponse;
  const items = data.data ?? [];

  const publicDomainReferences = items
    .filter((item) => item.is_public_domain && item.main_reference_number)
    .map((item) => item.main_reference_number as string);

  const commonsImagesByReference = await fetchAicCommonsImages(
    publicDomainReferences,
    signal
  );

  return items
    .map((item, index) => normalizeAicItem(item, index, commonsImagesByReference))
    .filter((result): result is ArtworkResult => result !== null)
    .slice(0, limit);
}
