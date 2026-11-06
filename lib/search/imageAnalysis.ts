import sharp from "sharp";
import { ArtworkResult } from "@/lib/types/artwork";

// Pixel-level checks on result thumbnails. Text metadata can't say whether
// a portrait is actually dramatically lit (testers rejected every evenly lit
// "dramatic lighting" pick, 6/6) or whether a photo is blurred (P2), so these
// look at the image itself: no model, no API key, deterministic. Each
// thumbnail is shrunk to a small grayscale grid before measuring, which
// keeps a full candidate pool to well under a second of CPU.

export type ImageMetrics = {
  // Standard deviation of luminance, 0-1. Flat, evenly lit images sit
  // around 0.1-0.15; strong light-and-shadow images above ~0.25.
  contrast: number;
  // Share of pixels that are near-black / near-white.
  darkShare: number;
  brightShare: number;
  // 0-1: light against dark rather than an image that's just dark or
  // just busy. Two shapes count: low-key (mostly shadow with a genuinely
  // bright lit area -- a face lit from one side on black) and high-contrast
  // (strong tonal spread with deep shadows and real highlights).
  drama: number;
  // Edge strength (variance of the Laplacian) relative to the image's own
  // contrast, so a mostly-black low-key photo isn't mistaken for a blurred
  // one. Sharp images measure ~0.6+, motion-blurred ones ~0.2.
  sharpness: number;
};

// Below this, a photo reads as blurred (calibrated on Unsplash results:
// long-exposure/time-lapse dancers ~0.17-0.2, sharp photos 0.6-1.1).
export const BLURRED_SHARPNESS = 0.3;
// At or above this, an image counts as dramatically lit (top pick, filter
// ordering); calibrated so low-key portraits and Caravaggesque paintings
// clear it while evenly lit portraits don't.
export const DRAMATIC_LIGHTING_DRAMA = 0.5;
// Below this, an image measures as evenly lit (the flat self-portraits
// testers rejected for "dramatic lighting" measure 0-0.1).
export const FLAT_LIGHTING_DRAMA = 0.15;

const ANALYSIS_SIZE = 96;
const FETCH_TIMEOUT_MS = 2500;
const DARK_LEVEL = 0.24;
const BRIGHT_LEVEL = 0.75;

const CACHE_MAX_SIZE = 1000;
const metricsCache = new Map<string, ImageMetrics | null>();

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// Unsplash serves through imgix, so it can hand back a smaller version
// directly. 512px is what the vision check (visionJudge.ts) sends to the
// model; the pixel measures shrink it further.
export function analysisUrl(result: ArtworkResult): string {
  const url = result.thumbnailUrl || result.imageUrl;
  if (url.includes("images.unsplash.com")) {
    return `${url}${url.includes("?") ? "&" : "?"}w=512`;
  }
  return url;
}

// The pixel checks and the vision check both need every pool image at
// about the same moment; sharing the download (including one still in
// flight) means each image is fetched once per search.
const DOWNLOAD_CACHE_MAX_SIZE = 200;
const downloads = new Map<string, Promise<Buffer | null>>();

export function downloadImage(url: string): Promise<Buffer | null> {
  const cached = downloads.get(url);
  if (cached) return cached;

  const download = (async () => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
      return response.ok ? Buffer.from(await response.arrayBuffer()) : null;
    } catch {
      return null;
    }
  })();

  if (downloads.size >= DOWNLOAD_CACHE_MAX_SIZE) downloads.clear();
  downloads.set(url, download);
  return download;
}

function percentile(sorted: Float32Array, p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function measure(pixels: Buffer, width: number, height: number): ImageMetrics {
  const count = width * height;
  const luminance = new Float32Array(count);
  let sum = 0;
  let dark = 0;
  let bright = 0;

  for (let i = 0; i < count; i++) {
    const value = pixels[i] / 255;
    luminance[i] = value;
    sum += value;
    if (value < DARK_LEVEL) dark++;
    if (value > BRIGHT_LEVEL) bright++;
  }

  const mean = sum / count;
  let variance = 0;
  for (let i = 0; i < count; i++) variance += (luminance[i] - mean) ** 2;
  const contrast = Math.sqrt(variance / count);

  const sorted = Float32Array.from(luminance).sort();
  const highlights = percentile(sorted, 0.97);
  const peak = percentile(sorted, 0.995);

  let laplacianSum = 0;
  let laplacianSquares = 0;
  let laplacianCount = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const value =
        luminance[i - width] + luminance[i + width] + luminance[i - 1] + luminance[i + 1] - 4 * luminance[i];
      laplacianSum += value;
      laplacianSquares += value * value;
      laplacianCount++;
    }
  }
  const laplacianMean = laplacianSum / laplacianCount;
  const edgeVariance = laplacianSquares / laplacianCount - laplacianMean ** 2;
  const sharpness = edgeVariance / Math.max(contrast ** 2, 0.0025);

  const darkShare = dark / count;
  const lowKey = clamp01((darkShare - 0.55) / 0.3) * clamp01((peak - 0.4) / 0.35);
  const highContrast =
    clamp01((contrast - 0.15) / 0.13) *
    clamp01(darkShare / 0.25) *
    clamp01((highlights - 0.5) / 0.3);
  const drama = Math.max(lowKey, highContrast);

  return {
    contrast,
    darkShare,
    brightShare: bright / count,
    drama,
    sharpness
  };
}

async function analyzeUrl(url: string): Promise<ImageMetrics | null> {
  if (metricsCache.has(url)) return metricsCache.get(url) ?? null;

  let metrics: ImageMetrics | null = null;
  try {
    const input = await downloadImage(url);
    if (input) {
      const { data, info } = await sharp(input)
        .resize(ANALYSIS_SIZE, ANALYSIS_SIZE, { fit: "inside" })
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      metrics = measure(data, info.width, info.height);
    }
  } catch {
    metrics = null;
  }

  if (metricsCache.size >= CACHE_MAX_SIZE) metricsCache.clear();
  metricsCache.set(url, metrics);
  return metrics;
}

/**
 * Measures every result's thumbnail in parallel. Never throws -- an image
 * that fails to download or decode simply has no metrics, and callers
 * treat that as "unknown" rather than as a bad image.
 */
export async function analyzeResultImages(
  results: ArtworkResult[]
): Promise<Map<string, ImageMetrics>> {
  const entries = await Promise.all(
    results.map(async (result) => [result.id, await analyzeUrl(analysisUrl(result))] as const)
  );

  return new Map(
    entries.filter((entry): entry is readonly [string, ImageMetrics] => entry[1] !== null)
  );
}

// Score adjustments from image metrics. Lighting: up to +0.3 for strongly
// dramatic images, down to -0.2 for flat ones, but only on lighting
// queries. Blur: photos only -- soft brushwork in a painting measures like
// blur but isn't one.
const DRAMA_WEIGHT = 0.5;
const DRAMA_NEUTRAL = 0.4;
const PIXEL_BLUR_PENALTY = 0.25;

export function isPixelBlurred(result: ArtworkResult): boolean {
  return (
    result.source === "Unsplash" &&
    result.imageMetrics !== undefined &&
    result.imageMetrics.sharpness < BLURRED_SHARPNESS
  );
}

export function isDramaticallyLit(result: ArtworkResult): boolean {
  return (result.imageMetrics?.drama ?? 0) >= DRAMATIC_LIGHTING_DRAMA;
}

// --- Combined lighting judgment ---------------------------------------------
// When the vision check scored the image (lightingScore, 0-5, see
// visionJudge.ts), its score decides: it sees where the light falls, while
// pixels only see tonal spread. Pixels fail both ways -- a bright face on a
// black ground measures 1.0 however flat the light on the face (a 1/5
// "woman's face" was kept as lit for "dramatic lighting on face"), and a
// dark-toned painting lit from one side measures as flat. The pixel
// measure decides only when there's no vision score.
const VISION_LIT_SCORE = 4;
const VISION_FLAT_SCORE = 2;

export function isStronglyLit(result: ArtworkResult): boolean {
  if (result.lightingScore !== undefined) return result.lightingScore >= VISION_LIT_SCORE;
  return isDramaticallyLit(result);
}

export function isFlatForLighting(result: ArtworkResult): boolean {
  if (result.lightingScore !== undefined) return result.lightingScore <= VISION_FLAT_SCORE;
  return result.imageMetrics !== undefined && result.imageMetrics.drama < FLAT_LIGHTING_DRAMA;
}

export function applyImageMetrics(
  results: ArtworkResult[],
  metrics: Map<string, ImageMetrics>,
  options: { lighting: boolean; allowsBlur: boolean }
): ArtworkResult[] {
  return results
    .map((result) => {
      const imageMetrics = metrics.get(result.id);
      if (!imageMetrics) return result;

      const withMetrics = { ...result, imageMetrics };
      let adjustment = 0;
      if (options.lighting) adjustment += (imageMetrics.drama - DRAMA_NEUTRAL) * DRAMA_WEIGHT;
      if (!options.allowsBlur && isPixelBlurred(withMetrics)) adjustment -= PIXEL_BLUR_PENALTY;

      return {
        ...withMetrics,
        score: Number(((result.score ?? 0) + adjustment).toFixed(4))
      };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
