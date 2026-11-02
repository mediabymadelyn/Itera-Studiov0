import { ArtworkResult } from "@/lib/types/artwork";

type UnsplashSearchResponse = {
  results?: UnsplashPhoto[];
};

type UnsplashPhoto = {
  id: string;
  slug?: string;
  alt_description: string | null;
  description: string | null;
  seo_meta_description?: string | null;
  likes?: number;
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

// Unsplash's API guidelines require crediting the photographer (linked to
// their profile) and Unsplash, with every link back to Unsplash carrying
// these referral parameters. utm_source should match the application name
// registered in the Unsplash developer dashboard.
const UNSPLASH_UTM_PARAMS = "utm_source=itera_studio&utm_medium=referral";

function withUnsplashReferral(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}${UNSPLASH_UTM_PARAMS}`;
}

// Last X-Ratelimit-Remaining Unsplash reported (per server instance, so
// approximate). searchAll.ts uses it to stop spending extra variant
// searches when the hourly quota is nearly gone. null until the first call.
let lastRateLimitRemaining: number | null = null;

export function unsplashCallsRemaining(): number | null {
  return lastRateLimitRemaining;
}

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

// Unsplash search results carry no tags, and alt text is often one short
// sentence -- too sparse to confirm a result actually shows what was asked
// for (see subjectFilter.ts). The slug is the photo's description as words
// ("white-ceramic-mug-on-brown-table-<id>"), so it's a free second source.
function slugWords(photo: UnsplashPhoto): string[] {
  if (!photo.slug) return [];

  const words = photo.slug.split("-");
  if (words[words.length - 1] === photo.id) words.pop();

  return words.filter((word) => /^[a-z]{2,}$/.test(word));
}

// Likes span from 0 to tens of thousands; log scale keeps a viral photo
// from dominating. 10k+ likes saturates at 1.
function likesToQualitySignal(likes: number | undefined): number | undefined {
  if (!likes || likes <= 0) return undefined;

  return Math.min(1, Math.log10(likes + 1) / 4);
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
    originalLink: withUnsplashReferral(originalLink),
    thumbnailUrl: photo.urls.small || imageUrl,
    licenseType: "Unsplash License",
    sourceLink: withUnsplashReferral("https://unsplash.com/"),
    artistLink: photo.user.links?.html ? withUnsplashReferral(photo.user.links.html) : undefined,
    score: Math.max(0, 1 - index * 0.01),
    tags: slugWords(photo),
    shortDescription: [photo.description, photo.seo_meta_description]
      .filter((text): text is string => Boolean(text && text.trim() && !looksPromotional(text)))
      .join(" ") || undefined,
    qualitySignal: likesToQualitySignal(photo.likes)
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
    // Demo keys allow 50 requests/hour, so identical searches are served
    // from cache for an hour rather than five minutes.
    next: { revalidate: 3600 }
  });

  const remaining = Number(response.headers.get("x-ratelimit-remaining"));
  if (Number.isFinite(remaining) && response.headers.has("x-ratelimit-remaining")) {
    lastRateLimitRemaining = remaining;
  }

  if (!response.ok) {
    throw new Error(`Failed to search the Unsplash API (HTTP ${response.status}).`);
  }

  const data = (await response.json()) as UnsplashSearchResponse;

  return (data.results ?? [])
    .map((photo, index) => normalizeUnsplashPhoto(photo, index))
    .filter((result): result is ArtworkResult => result !== null)
    .slice(0, limit);
}
