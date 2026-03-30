import { ArtworkResult } from "@/lib/types/artwork";

type MetSearchResponse = {
  total: number;
  objectIDs: number[] | null;
};

type MetObjectResponse = {
  objectID: number;
  title: string;
  artistDisplayName: string;
  primaryImage: string;
  primaryImageSmall: string;
  objectURL: string;
  isPublicDomain: boolean;
};

const MET_BASE_URL = "https://collectionapi.metmuseum.org/public/collection/v1";

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
    score: Math.max(0, 1 - index * 0.01)
  };
}

export async function searchMetArtworks(
  query: string,
  limit = 6
): Promise<ArtworkResult[]> {
  const searchUrl = `${MET_BASE_URL}/search?hasImages=true&q=${encodeURIComponent(
    query
  )}`;

  const searchResponse = await fetch(searchUrl, {
    next: { revalidate: 300 }
  });

  if (!searchResponse.ok) {
    throw new Error("Failed to search the Met API.");
  }

  const searchData = (await searchResponse.json()) as MetSearchResponse;
  const objectIds = (searchData.objectIDs ?? []).slice(0, 18);

  if (objectIds.length === 0) {
    return [];
  }

  const objectResponses = await Promise.all(
    objectIds.map(async (objectId) => {
      const objectResponse = await fetch(`${MET_BASE_URL}/objects/${objectId}`, {
        next: { revalidate: 300 }
      });

      if (!objectResponse.ok) {
        return null;
      }

      return (await objectResponse.json()) as MetObjectResponse;
    })
  );

  const normalized = objectResponses
    .map((object, index) => {
      if (!object) {
        return null;
      }

      return normalizeMetObject(object, index);
    })
    .filter((result): result is ArtworkResult => result !== null)
    .slice(0, limit);

  return normalized;
}
