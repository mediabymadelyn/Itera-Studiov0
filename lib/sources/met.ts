import { ArtworkResult } from "@/lib/types/artwork";

type MetSearchResponse = {
  total: number;
  objectIDs: number[] | null;
};

type MetTag = {
  term?: string;
};

type MetObjectResponse = {
  objectID: number;
  title: string;
  artistDisplayName: string;
  primaryImage: string;
  primaryImageSmall: string;
  objectURL: string;
  isPublicDomain: boolean;
  isHighlight?: boolean;
  artistNationality?: string;
  objectWikidata_URL?: string;
  tags?: MetTag[] | null;
  medium?: string;
  classification?: string;
  culture?: string;
  objectDate?: string;
};

const MET_BASE_URL = "https://collectionapi.metmuseum.org/public/collection/v1";
// The Met retired v1/search on 2026-10-01 (it now returns 410 Gone). v1.1 is
// the paginated replacement; object lookups still live under v1.
const MET_SEARCH_URL = "https://collectionapi.metmuseum.org/public/collection/v1.1/search";
const MET_SEARCH_LIMIT = 18;
// The Met's CDN (Imperva) temporarily blocks clients that send too many
// requests in a short window -- every search costs one request per object,
// so object records (which rarely change) are cached for a day and search
// results for an hour.
const MET_SEARCH_REVALIDATE_SECONDS = 3600;
const MET_OBJECT_REVALIDATE_SECONDS = 86400;

// Met departments whose collections are under-represented in a plain
// keyword search (P6: "no African art"). searchAll.ts runs one small extra
// search in a single department per query to widen cultural coverage.
export const MET_NON_WESTERN_DEPARTMENT_IDS = [
  5, // Arts of Africa, Oceania, and the Americas
  6, // Asian Art
  14 // Islamic Art
] as const;

export type MetSearchOptions = {
  departmentId?: number;
  // Each candidate costs one object request, so secondary searches fetch
  // fewer of them than the primary one.
  objectLimit?: number;
};

function normalizeMetObject(
  object: MetObjectResponse,
  index: number
): ArtworkResult | null {
  const imageUrl = object.primaryImage || object.primaryImageSmall;

  if (!imageUrl) {
    return null;
  }

  return {
    id: `met-${object.objectID}`,
    title: object.title || "Untitled",
    artist: object.artistDisplayName || "Unknown artist",
    source: "The Metropolitan Museum of Art",
    imageUrl,
    originalLink:
      object.objectURL ||
      `https://www.metmuseum.org/art/collection/search/${object.objectID}`,
    thumbnailUrl: object.primaryImageSmall || imageUrl,
    licenseType: object.isPublicDomain ? "Public Domain" : "Unknown",
    sourceLink: "https://www.metmuseum.org",
    score: Math.max(0, 1 - index * 0.01),
    tags: object.tags
      ?.map((tag) => tag.term)
      .filter((term): term is string => Boolean(term)),
    medium: object.medium,
    classification: object.classification,
    culture: object.culture || object.artistNationality,
    qualitySignal: object.isHighlight ? 1 : undefined,
    wikidataId: object.objectWikidata_URL?.split("/").pop() || undefined,
    objectDate: object.objectDate
  };
}

export async function searchMetArtworks(
  query: string,
  limit = 6,
  options: MetSearchOptions = {}
): Promise<ArtworkResult[]> {
  const objectLimit = options.objectLimit ?? MET_SEARCH_LIMIT;
  const searchParams = new URLSearchParams({
    hasImages: "true",
    limit: String(objectLimit),
    q: query
  });

  if (options.departmentId !== undefined) {
    searchParams.set("departmentId", String(options.departmentId));
  }

  const searchUrl = `${MET_SEARCH_URL}?${searchParams.toString()}`;

  const searchResponse = await fetch(searchUrl, {
    next: { revalidate: MET_SEARCH_REVALIDATE_SECONDS }
  });

  if (!searchResponse.ok) {
    throw new Error(`Failed to search the Met API (HTTP ${searchResponse.status}).`);
  }

  const searchData = (await searchResponse.json()) as MetSearchResponse;
  const objectIds = (searchData.objectIDs ?? []).slice(0, objectLimit);

  if (objectIds.length === 0) {
    return [];
  }

  return (await fetchMetObjects(objectIds)).slice(0, limit);
}

/**
 * Fetches and normalizes specific Met objects by ID, in the given order
 * (score reflects position). Objects that fail to load or have no image are
 * skipped. Used by search above and by the curated lighting list.
 */
export async function fetchMetObjects(objectIds: number[]): Promise<ArtworkResult[]> {
  const objectResponses = await Promise.all(
    objectIds.map(async (objectId) => {
      const objectResponse = await fetch(`${MET_BASE_URL}/objects/${objectId}`, {
        next: { revalidate: MET_OBJECT_REVALIDATE_SECONDS }
      });

      if (!objectResponse.ok) {
        return null;
      }

      return (await objectResponse.json()) as MetObjectResponse;
    })
  );

  return objectResponses
    .map((object, index) => {
      if (!object) {
        return null;
      }

      return normalizeMetObject(object, index);
    })
    .filter((result): result is ArtworkResult => result !== null);
}
