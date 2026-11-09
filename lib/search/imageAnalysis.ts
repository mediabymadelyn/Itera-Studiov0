import sharp from "sharp";
import { ArtworkResult } from "@/lib/types/artwork";
import { MONOCHROME_COLORFULNESS } from "@/lib/search/categories";

// Pixel-level checks on result thumbnails. Text metadata can't say whether
// a portrait is actually dramatically lit (testers rejected every evenly lit
// "dramatic lighting" pick, 6/6) or whether a photo is blurred (P2), so these
// look at the image itself: no model, no API key, deterministic. Each
// thumbnail is shrunk to a small grid before measuring, which keeps a full
// candidate pool to well under a second of CPU.

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
  // How colorful the image is (Hasler & Suesstrunk 2003; 0 = grey, ~45+ =
  // "quite colorful").
  colorfulness: number;
  // Main colors, largest first, with their share of the image (0-1): shown
  // as swatches. (Warm/cool comes from the vision judge: measured from
  // pixels it matched the eval labels no better than calling everything
  // warm, since varnish and museum photography cast paintings warm.)
  palette: { color: string; share: number }[];
};

const PALETTE_SIZE = 5;
const PALETTE_ITERATIONS = 8;

// The black-and-white line is shared with the Color filter's sub-tags.

export function isMonochrome(result: ArtworkResult): boolean {
  return result.imageMetrics !== undefined && result.imageMetrics.colorfulness < MONOCHROME_COLORFULNESS;
}

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
  // Opponent color channels for colorfulness: red-green and yellow-blue.
  let rgSum = 0;
  let rgSquares = 0;
  let ybSum = 0;
  let ybSquares = 0;

  for (let i = 0; i < count; i++) {
    const r = pixels[i * 3];
    const g = pixels[i * 3 + 1];
    const b = pixels[i * 3 + 2];
    const value = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    luminance[i] = value;
    sum += value;
    if (value < DARK_LEVEL) dark++;
    if (value > BRIGHT_LEVEL) bright++;

    const rg = r - g;
    const yb = 0.5 * (r + g) - b;
    rgSum += rg;
    rgSquares += rg * rg;
    ybSum += yb;
    ybSquares += yb * yb;
  }

  const palette = paletteOf(pixels, count);
  const rgMean = rgSum / count;
  const ybMean = ybSum / count;
  const rgSpread = Math.max(0, rgSquares / count - rgMean ** 2);
  const ybSpread = Math.max(0, ybSquares / count - ybMean ** 2);
  const colorfulness = Math.sqrt(rgSpread + ybSpread) + 0.3 * Math.sqrt(rgMean ** 2 + ybMean ** 2);

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
    sharpness,
    colorfulness,
    palette
  };
}

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The main colors, by k-means over the small analysis grid (deterministic:
 * starts from evenly spaced pixels by brightness).
 */
function paletteOf(pixels: Buffer, count: number): ImageMetrics["palette"] {
  const points: [number, number, number][] = [];
  for (let i = 0; i < count; i++) points.push([pixels[i * 3], pixels[i * 3 + 1], pixels[i * 3 + 2]]);

  const byBrightness = [...points].sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  let centers = Array.from({ length: PALETTE_SIZE }, (_, k) =>
    [...byBrightness[Math.floor(((k + 0.5) / PALETTE_SIZE) * (byBrightness.length - 1))]] as [number, number, number]
  );
  let assignment = new Array<number>(points.length).fill(0);
  for (let iteration = 0; iteration < PALETTE_ITERATIONS; iteration++) {
    assignment = points.map((point) => {
      let best = 0;
      let bestDistance = Infinity;
      centers.forEach((center, k) => {
        const distance = (point[0] - center[0]) ** 2 + (point[1] - center[1]) ** 2 + (point[2] - center[2]) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = k;
        }
      });
      return best;
    });
    centers = centers.map((center, k) => {
      const members = points.filter((_, i) => assignment[i] === k);
      if (members.length === 0) return center;
      return [0, 1, 2].map((c) => members.reduce((sum, m) => sum + m[c], 0) / members.length) as [number, number, number];
    });
  }

  return centers
    .map((center, k) => ({
      color: hex(...center),
      share: Number((assignment.filter((a) => a === k).length / points.length).toFixed(3))
    }))
    .filter((swatch) => swatch.share > 0)
    .sort((a, b) => b.share - a.share);
}

async function analyzeUrl(url: string): Promise<ImageMetrics | null> {
  if (metricsCache.has(url)) return metricsCache.get(url) ?? null;

  let metrics: ImageMetrics | null = null;
  try {
    const input = await downloadImage(url);
    if (input) {
      const { data, info } = await sharp(input)
        .resize(ANALYSIS_SIZE, ANALYSIS_SIZE, { fit: "inside" })
        .removeAlpha()
        .toColourspace("srgb")
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
