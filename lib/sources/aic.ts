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
  place_of_origin?: string;
  artwork_type_title?: string;
};

const AIC_SEARCH_URL = "https://api.artic.edu/api/v1/artworks/search";
const AIC_ARTWORKS_URL = "https://api.artic.edu/api/v1/artworks";
const AIC_FIELDS =
  "id,title,artist_display,main_reference_number,is_public_domain,subject_titles,style_titles,technique_titles,theme_titles,description,short_description,place_of_origin,artwork_type_title";
// AIC's Cloudflare returns 403 for Node's default `User-Agent: node`, so
// identify the client explicitly. AIC's docs ask for AIC-User-Agent; see
// https://api.artic.edu/docs/#authentication
const USER_AGENT = "IteraStudioArtSearch/1.0";

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
    shortDescription: item.short_description,
    culture: item.place_of_origin,
    // "Painting", "Print", "Sculpture", "Vessel"... -- the same role as the
    // Met's classification, used to cap 3D objects (see queryTerms.ts).
    classification: item.artwork_type_title
  };
}

export async function searchAicArtworks(
  query: string,
  limit = 6,
  signal?: AbortSignal
): Promise<ArtworkResult[]> {
  const searchParams = new URLSearchParams({
    q: query,
    fields: AIC_FIELDS,
    limit: "18",
    page: "1"
  });

  const response = await fetch(`${AIC_SEARCH_URL}?${searchParams.toString()}`, {
    headers: {
      "AIC-User-Agent": USER_AGENT,
      "User-Agent": USER_AGENT
    },
    signal,
    next: { revalidate: 300 }
  });

  if (!response.ok) {
    throw new Error(`Failed to search the AIC API (HTTP ${response.status}).`);
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

/**
 * Fetches specific AIC artworks by ID in one request, using images the
 * caller already has (Wikimedia Commons URLs, keyed by AIC ID) since AIC's
 * own image host blocks hotlinking. Used by the curated lighting list,
 * whose entries carry their Commons image from Wikidata.
 */
export async function fetchAicArtworksByIds(
  imagesById: Map<string, string>,
  signal?: AbortSignal
): Promise<ArtworkResult[]> {
  const ids = Array.from(imagesById.keys());
  if (ids.length === 0) return [];

  const searchParams = new URLSearchParams({ ids: ids.join(","), fields: AIC_FIELDS });
  const response = await fetch(`${AIC_ARTWORKS_URL}?${searchParams.toString()}`, {
    headers: {
      "AIC-User-Agent": USER_AGENT,
      "User-Agent": USER_AGENT
    },
    signal,
    next: { revalidate: 86400 }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch AIC artworks (HTTP ${response.status}).`);
  }

  const data = (await response.json()) as AicSearchResponse;
  const items = data.data ?? [];
  const imagesByReference = new Map(
    items
      .filter((item) => item.main_reference_number && imagesById.has(String(item.id)))
      .map((item) => [item.main_reference_number as string, imagesById.get(String(item.id)) as string])
  );

  return items
    .map((item, index) => normalizeAicItem(item, index, imagesByReference))
    .filter((result): result is ArtworkResult => result !== null);
}
