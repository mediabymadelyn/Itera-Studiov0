/**
 * Builds lib/data/featured-palettes.json: five-color palettes from
 * public-domain museum artworks -- the museum library
 * (lib/data/museum-library.json) plus colorful searches below -- measured
 * from their pixels (no AI calls). Only clearly colorful ones are kept. The home page shows one as paint chips, a different
 * artwork each visit (components/FeaturedPalette.tsx), and the chip
 * highlight and section dividers take the same colors.
 *
 * A plain five-cluster average gave chiaroscuro paintings five near-blacks,
 * so this finds ten clusters and keeps the five most different from each
 * other (ignoring specks), which keeps the candle's gold or a red sleeve.
 * Near-grey works (prints, drawings) and palettes with no real range of
 * light and dark are left out. Rerun after rebuilding the library:
 *   npm run build:palettes
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { fetchAicCommonsImages } from "../lib/sources/wikidataAicImages";
import { analysisUrl, downloadImage } from "../lib/search/imageAnalysis";
import type { ArtworkResult } from "../lib/types/artwork";

const LIBRARY = "lib/data/museum-library.json";
const CACHE_DIR = "data/library-cache";
const USER_AGENT = "IteraStudioArtSearch/1.0 (palette build; non-commercial)";
const SEARCH_LIMIT = 8;
// The library is mostly dark, tenebrist paintings, so colorful palettes
// also come from these public-domain searches at the same two museums:
// Impressionist and Post-Impressionist painters, Japanese prints, Persian
// manuscript pages. Department 11 = European Paintings, 6 = Asian Art,
// 14 = Islamic Art.
const MET_COLOR_SEARCHES: [number, string][] = [
  [11, "Monet"], [11, "Renoir"], [11, "Van Gogh"], [11, "Gauguin"], [11, "Cézanne"],
  [11, "Degas"], [11, "Turner"], [6, "Hiroshige"], [6, "Hokusai"], [14, "Shahnama"]
];
const AIC_COLOR_SEARCHES = ["Monet", "Van Gogh", "Renoir", "Seurat", "Gauguin", "Caillebotte", "Hiroshige"];
const OUTPUT = "lib/data/featured-palettes.json";
const SIZE = 96;
const CLUSTERS = 10;
const ITERATIONS = 10;
const PALETTE_SIZE = 5;
// Clusters smaller than this share of the image are specks, not palette.
const MIN_CLUSTER_SHARE = 0.02;
// Only clearly colorful palettes are featured (the earlier ones read as
// five shades of brown): colors from at least MIN_HUE_FAMILIES different
// hue families (40-degree slices of the color wheel), real color strength
// on average (chroma, 0-255: dark browns have little, though they count as
// "saturated"), and a real range of light and dark.
const MIN_HUE_FAMILIES = 2;
const HUE_FAMILY_DEGREES = 40;
const COLORED_CHROMA = 35;
const MIN_MEAN_CHROMA = 36;
const MIN_LIGHTEST = 130;
const MIN_LIGHT_RANGE = 90;
// So the rotation stays varied (Van Gogh alone passed seven times).
const MAX_PER_ARTIST = 3;

type RGB = [number, number, number];

const distance = (a: RGB, b: RGB) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const luminance = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const saturation = ([r, g, b]: RGB) => {
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
};
const chroma = ([r, g, b]: RGB) => Math.max(r, g, b) - Math.min(r, g, b);
const hue = ([r, g, b]: RGB) => {
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return 0;
  const h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (h * 60 + 360) % 360;
};

function isColorful(palette: RGB[]): boolean {
  const families = new Set(
    palette.filter((c) => chroma(c) >= COLORED_CHROMA).map((c) => Math.floor(hue(c) / HUE_FAMILY_DEGREES))
  );
  const meanChroma = palette.reduce((sum, c) => sum + chroma(c), 0) / palette.length;
  const lightest = luminance(palette[palette.length - 1]);
  return (
    families.size >= MIN_HUE_FAMILIES &&
    meanChroma >= MIN_MEAN_CHROMA &&
    lightest >= MIN_LIGHTEST &&
    lightest - luminance(palette[0]) >= MIN_LIGHT_RANGE
  );
}
const hex = (c: RGB) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

function clusters(points: RGB[]): { color: RGB; share: number }[] {
  const sorted = [...points].sort((a, b) => luminance(a) - luminance(b));
  let centers: RGB[] = Array.from({ length: CLUSTERS }, (_, k) => [...sorted[Math.floor(((k + 0.5) / CLUSTERS) * (sorted.length - 1))]] as RGB);
  let assignment: number[] = [];
  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    assignment = points.map((point) => centers.reduce((best, center, k) => (distance(point, center) < distance(point, centers[best]) ? k : best), 0));
    centers = centers.map((center, k) => {
      const members = points.filter((_, i) => assignment[i] === k);
      return members.length ? ([0, 1, 2].map((c) => members.reduce((s, m) => s + m[c], 0) / members.length) as RGB) : center;
    });
  }
  return centers.map((color, k) => ({ color, share: assignment.filter((a) => a === k).length / points.length }));
}

/** Five clusters that differ most, starting from the most colorful sizeable one. */
function distinctFive(found: { color: RGB; share: number }[]): RGB[] {
  const candidates = found.filter((c) => c.share >= MIN_CLUSTER_SHARE);
  if (candidates.length < PALETTE_SIZE) return [];
  const chosen = [candidates.reduce((best, c) => (saturation(c.color) * Math.sqrt(c.share) > saturation(best.color) * Math.sqrt(best.share) ? c : best))];
  while (chosen.length < PALETTE_SIZE) {
    const next = candidates
      .filter((c) => !chosen.includes(c))
      .reduce((best, c) => {
        const gap = (x: typeof c) => Math.min(...chosen.map((picked) => distance(x.color, picked.color)));
        return gap(c) > gap(best) ? c : best;
      });
    chosen.push(next);
  }
  return chosen.map((c) => c.color).sort((a, b) => luminance(a) - luminance(b));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function cachedJson(key: string, url: string, delayMs: number, headers: Record<string, string> = {}): Promise<any> {
  const path = `${CACHE_DIR}/${key}.json`;
  if (existsSync(path)) {
    const cached = JSON.parse(readFileSync(path, "utf8"));
    return cached.body ?? cached;
  }
  await sleep(delayMs);
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, ...headers } });
  if (!response.ok) return null;
  const body = await response.json();
  writeFileSync(path, JSON.stringify({ status: response.status, body }));
  return body;
}

/** Public-domain works with images from the colorful searches above. */
async function colorfulCandidates(): Promise<ArtworkResult[]> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const found: ArtworkResult[] = [];
  for (const [departmentId, q] of MET_COLOR_SEARCHES) {
    const search = await cachedJson(
      `met-search-${departmentId}-${q}`,
      `https://collectionapi.metmuseum.org/public/collection/v1.1/search?hasImages=true&limit=${SEARCH_LIMIT}&departmentId=${departmentId}&q=${encodeURIComponent(q)}`,
      1000
    );
    for (const id of (search?.objectIDs ?? []).slice(0, SEARCH_LIMIT)) {
      const object = await cachedJson(`met-${id}`, `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`, 1000);
      if (!object?.isPublicDomain || !object.primaryImageSmall) continue;
      found.push({
        id: `met-${id}`,
        title: object.title,
        artist: object.artistDisplayName || "Unknown artist",
        source: "The Metropolitan Museum of Art",
        imageUrl: object.primaryImage,
        thumbnailUrl: object.primaryImageSmall,
        originalLink: object.objectURL
      });
    }
  }
  const aicItems: any[] = [];
  for (const q of AIC_COLOR_SEARCHES) {
    const search = await cachedJson(
      `aic-color-search-${q}`,
      `https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(q)}&limit=${SEARCH_LIMIT}&fields=id,title,artist_title,is_public_domain,main_reference_number`,
      400,
      { "AIC-User-Agent": USER_AGENT }
    );
    aicItems.push(...(search?.data ?? []).filter((item: any) => item.is_public_domain && item.main_reference_number));
  }
  const commons = await fetchAicCommonsImages(aicItems.map((item) => item.main_reference_number));
  for (const item of aicItems) {
    const image = commons.get(item.main_reference_number);
    if (!image) continue;
    found.push({
      id: `aic-${item.id}`,
      title: item.title,
      artist: item.artist_title || "Unknown artist",
      source: "Art Institute of Chicago",
      imageUrl: `${image}?width=843`,
      thumbnailUrl: `${image}?width=400`,
      originalLink: `https://www.artic.edu/artworks/${item.id}`
    });
  }
  return found;
}

const library = (JSON.parse(readFileSync(LIBRARY, "utf8")) as { works: ArtworkResult[] }).works;
const seen = new Set<string>();
const works = [...library, ...(await colorfulCandidates())].filter((work) => !seen.has(work.id) && seen.add(work.id));
console.log(`${works.length} candidate works`);
const featured: object[] = [];

for (const work of works) {
  const input = await downloadImage(analysisUrl(work));
  if (!input) continue;
  const { data, info } = await sharp(input).resize(SIZE, SIZE, { fit: "inside" }).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const points: RGB[] = [];
  for (let i = 0; i < info.width * info.height; i++) points.push([data[i * 3], data[i * 3 + 1], data[i * 3 + 2]]);

  const palette = distinctFive(clusters(points));
  if (palette.length < PALETTE_SIZE) continue;
  if (!isColorful(palette)) continue;

  featured.push({
    id: work.id,
    title: work.title,
    artist: work.artist,
    date: work.objectDate ?? null,
    source: work.source,
    link: work.originalLink,
    // Dark to light, like a row of paint chips.
    colors: palette.map(hex)
  });
  process.stdout.write(".");
}

const perArtist = new Map<string, number>();
const varied = (featured as { artist: string }[]).filter((work) => {
  const count = perArtist.get(work.artist) ?? 0;
  perArtist.set(work.artist, count + 1);
  return count < MAX_PER_ARTIST;
});
writeFileSync(OUTPUT, JSON.stringify({ builtAt: new Date().toISOString(), works: varied }, null, 2) + "\n");
console.log(`\nWrote ${OUTPUT}: ${varied.length} palettes (${featured.length} of ${works.length} works were colorful enough).`);
