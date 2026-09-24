import { ArtworkResult } from "@/lib/types/artwork";

type UnsplashSearchResponse = {
  results?: UnsplashPhoto[];
};

type UnsplashPhoto = {
  id: string;
  alt_description: string | null;
  description: string | null;
  urls: {
    regular?: string;
    small?: string;
  };
  links: {
    html?: string;
  };
  user: {
    name?: string;
    links?: {
      html?: string;
    };
  };
};

const UNSPLASH_SEARCH_URL = "https://api.unsplash.com/search/photos";

// `description` is free text the uploader wrote themselves and can be a
// promotional blurb (brand name, "mockup", a URL) rather than a real
// description -- `alt_description` is Unsplash's own literal, accessibility
// -focused text and is far more consistently clean, so it's tried first.
// Even so, skip any candidate that still looks like an ad.
function looksPromotional(text: string): boolean {
  return /https?:\/\/|www\.[a-z]/i.test(text);
}

function pickUnsplashTitle(photo: UnsplashPhoto): string {
  const candidates = [photo.alt_description, photo.description].filter(
    (text): text is string => Boolean(text && text.trim())
  );

  const clean = candidates.find((text) => !looksPromotional(text));

  return clean || "Untitled photo";
}

function normalizeUnsplashPhoto(
  photo: UnsplashPhoto,
  index: number
): ArtworkResult | null {
  const imageUrl = photo.urls.regular || photo.urls.small;
  const originalLink = photo.links.html;

  if (!imageUrl || !originalLink) {
    return null;
  }

  return {
    id: `unsplash-${photo.id}`,
    title: pickUnsplashTitle(photo),
    artist: photo.user.name || "Unknown photographer",
    source: "Unsplash",
    imageUrl,
    originalLink,
    thumbnailUrl: photo.urls.small || imageUrl,
    licenseType: "Unsplash License",
    sourceLink: photo.user.links?.html || "https://unsplash.com",
    score: Math.max(0, 1 - index * 0.01)
  };
}

export async function searchUnsplashArtworks(
  query: string,
  limit = 6
): Promise<ArtworkResult[]> {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;

  if (!accessKey) {
    return [];
  }

  const searchParams = new URLSearchParams({
    query,
    per_page: "18",
    page: "1",
    content_filter: "high"
  });

  const response = await fetch(`${UNSPLASH_SEARCH_URL}?${searchParams.toString()}`, {
    headers: {
      Authorization: `Client-ID ${accessKey}`
    },
    next: { revalidate: 300 }
  });

  if (!response.ok) {
    throw new Error("Failed to search the Unsplash API.");
  }

  const data = (await response.json()) as UnsplashSearchResponse;

  return (data.results ?? [])
    .map((photo, index) => normalizeUnsplashPhoto(photo, index))
    .filter((result): result is ArtworkResult => result !== null)
    .slice(0, limit);
}
