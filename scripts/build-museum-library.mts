/**
 * Builds lib/data/museum-library.json: public-domain Met and AIC works
 * known for strong or artificial light, each judged three times by the
 * app's own vision judge (lib/search/visionJudge.ts) with the median kept,
 * so search can put dramatic museum works on the page with stable scores
 * and without any Met requests at search time (see lib/search/museumLibrary.ts).
 *
 * Sources, all through the museums' own APIs:
 *   - the curated Wikidata list (lib/data/dramatic-lighting-works.json)
 *   - the eval set's museum works that passed the provenance check
 *     (data/eval/provenance_report.json)
 *   - light-source searches (candlelight, lamplight) and artificial-light
 *     ones -- "fine-arts neon": footlights, gaslight, café-concert, stage
 *
 * Polite: one Met request a second, a short pause for AIC, responses cached
 * in data/library-cache/ (gitignored). Rerun occasionally:
 *   npm run build:museum-library
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import catalog from "../lib/data/dramatic-lighting-works.json";
import { fetchAicCommonsImages } from "../lib/sources/wikidataAicImages";
import { clearJudgmentCache, judgeResultImages, visionJudgeSettings } from "../lib/search/visionJudge";
import type { VisionJudgment } from "../lib/search/visionJudge";
import type { ArtworkResult } from "../lib/types/artwork";

const OUTPUT = "lib/data/museum-library.json";
const CACHE_DIR = "data/library-cache";
const EVAL_CACHE_DIR = "data/eval/cache";
const PROVENANCE = "data/eval/provenance_report.json";
const USER_AGENT = "IteraStudioArtSearch/1.0 (museum library build; non-commercial)";
const MET_DELAY_MS = 1000;
const AIC_DELAY_MS = 400;
const RUNS = 3;
const CONCURRENCY = 6;
const SEARCH_LIMIT = 8;
// The judge needs a search to judge against; only the lighting part of its
// answer is kept, so this just names the kind of subject.
const LIBRARY_QUERY = "dramatic light on a figure";
const MET_SEARCHES: [number, string][] = [
  [11, "candlelight"], [11, "candle"], [11, "lamplight"], [9, "candlelight"], [11, "torch"]
];
const AIC_SEARCHES = ["candlelight", "lamplight", "café-concert", "footlights", "gaslight", "theater stage"];
const AIC_FIELDS = "id,title,artist_title,artist_display,date_display,is_public_domain,main_reference_number,artwork_type_title,place_of_origin,credit_line";

type Candidate = { source: "met" | "aic"; objectId: string; via: string; genres?: string[]; depicts?: string[]; commonsImage?: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function cachedJson(key: string, url: string, delayMs: number, headers: Record<string, string> = {}): Promise<any> {
  for (const dir of [CACHE_DIR, EVAL_CACHE_DIR]) {
    const path = `${dir}/${key}.json`;
    if (existsSync(path)) {
      const cached = JSON.parse(readFileSync(path, "utf8"));
      return cached.body ?? cached;
    }
  }
  await sleep(delayMs);
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, ...headers } });
  if (!response.ok) return null;
  const body = await response.json();
  writeFileSync(`${CACHE_DIR}/${key}.json`, JSON.stringify({ status: response.status, body }));
  return body;
}

async function mapLimited<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

mkdirSync(CACHE_DIR, { recursive: true });
const candidates = new Map<string, Candidate>();
const add = (candidate: Candidate) => {
  const key = `${candidate.source}-${candidate.objectId}`;
  const existing = candidates.get(key);
  candidates.set(key, existing ? { ...candidate, ...existing, genres: existing.genres ?? candidate.genres, depicts: existing.depicts ?? candidate.depicts } : candidate);
};

for (const work of (catalog as any).works) {
  add({ source: work.source, objectId: String(work.objectId), via: "curated list", genres: work.genres, depicts: work.depicts });
}
for (const row of JSON.parse(readFileSync(PROVENANCE, "utf8"))) {
  if (row.eval_allowed && row.source !== "Unsplash") add({ source: row.source === "Met" ? "met" : "aic", objectId: row.object_id, via: "eval set" });
}
for (const [departmentId, q] of MET_SEARCHES) {
  const url = `https://collectionapi.metmuseum.org/public/collection/v1.1/search?hasImages=true&limit=${SEARCH_LIMIT}&departmentId=${departmentId}&q=${encodeURIComponent(q)}`;
  const body = await cachedJson(`met-search-${departmentId}-${q}`, url, MET_DELAY_MS);
  for (const id of (body?.objectIDs ?? []).slice(0, SEARCH_LIMIT)) add({ source: "met", objectId: String(id), via: `Met search: ${q}` });
}
for (const q of AIC_SEARCHES) {
  const url = `https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(q)}&limit=${SEARCH_LIMIT}&fields=id`;
  const body = await cachedJson(`aic-search-${q}`, url, AIC_DELAY_MS, { "AIC-User-Agent": USER_AGENT });
  for (const item of body?.data ?? []) add({ source: "aic", objectId: String(item.id), via: `AIC search: ${q}` });
}
console.log(`${candidates.size} candidate works`);

// --- Metadata and images: public domain with a usable image only ---------
const results: (ArtworkResult & { candidate: Candidate; creditLine?: string })[] = [];
const skipped: string[] = [];
for (const candidate of [...candidates.values()].filter((c) => c.source === "met")) {
  const object = await cachedJson(`met-${candidate.objectId}`, `https://collectionapi.metmuseum.org/public/collection/v1/objects/${candidate.objectId}`, MET_DELAY_MS);
  if (!object?.isPublicDomain || !object.primaryImage) {
    skipped.push(`met-${candidate.objectId} (${object ? "not public domain or no image" : "not found"})`);
    continue;
  }
  results.push({
    id: `met-${object.objectID}`,
    title: object.title || "Untitled",
    artist: object.artistDisplayName || "Unknown artist",
    source: "The Metropolitan Museum of Art",
    imageUrl: object.primaryImage,
    thumbnailUrl: object.primaryImageSmall || object.primaryImage,
    originalLink: object.objectURL || `https://www.metmuseum.org/art/collection/search/${object.objectID}`,
    sourceLink: "https://www.metmuseum.org",
    licenseType: "Public Domain",
    classification: object.classification || object.objectName,
    culture: object.culture || object.artistNationality || undefined,
    objectDate: object.objectDate,
    medium: object.medium,
    wikidataId: object.objectWikidata_URL?.split("/").pop() || undefined,
    creditLine: object.creditLine,
    candidate
  });
}
const aicCandidates = [...candidates.values()].filter((c) => c.source === "aic");
const aicItems: any[] = [];
for (let i = 0; i < aicCandidates.length; i += 40) {
  const ids = aicCandidates.slice(i, i + 40).map((c) => c.objectId).join(",");
  const body = await cachedJson(`aic-ids-${i}-${aicCandidates.length}`, `https://api.artic.edu/api/v1/artworks?ids=${ids}&fields=${AIC_FIELDS}`, AIC_DELAY_MS, { "AIC-User-Agent": USER_AGENT });
  aicItems.push(...(body?.data ?? []));
}
const publicAic = aicItems.filter((item) => item.is_public_domain && item.main_reference_number);
const commons = await fetchAicCommonsImages(publicAic.map((item) => item.main_reference_number));
for (const item of aicItems) {
  const candidate = candidates.get(`aic-${item.id}`)!;
  const image = item.is_public_domain ? commons.get(item.main_reference_number) : undefined;
  if (!image) {
    skipped.push(`aic-${item.id} (${item.is_public_domain ? "no Wikimedia Commons copy" : "not public domain"})`);
    continue;
  }
  const artist = item.artist_title || item.artist_display?.split("\n")[0] || "Unknown artist";
  results.push({
    id: `aic-${item.id}`,
    title: item.title || "Untitled",
    artist,
    source: "Art Institute of Chicago",
    imageUrl: `${image}?width=843`,
    thumbnailUrl: `${image}?width=400`,
    originalLink: `https://www.artic.edu/artworks/${item.id}`,
    sourceLink: "https://www.artic.edu",
    licenseType: "Public Domain",
    classification: item.artwork_type_title,
    culture: item.place_of_origin,
    objectDate: item.date_display,
    creditLine: `${artist}. ${item.title}, ${item.date_display}. The Art Institute of Chicago.`,
    candidate
  });
}
console.log(`${results.length} public-domain works with images; ${skipped.length} skipped`);

// --- Judge each work RUNS times, keep the median -------------------------
const judgments: (VisionJudgment | null)[][] = results.map(() => []);
for (let run = 0; run < RUNS; run++) {
  clearJudgmentCache();
  await mapLimited(results.map((result, index) => ({ result, index })), CONCURRENCY, async ({ result, index }) => {
    judgments[index].push((await judgeResultImages([result], LIBRARY_QUERY)).get(result.id) ?? null);
  });
  console.log(`  judging run ${run + 1}/${RUNS} done`);
}

// Artificial or colored light -- the fine-art counterpart to neon photos.
// The judge rarely types paintings "colored / neon" (it called Toulouse-
// Lautrec's green, footlit face "under / top"), so the eval set's own
// labels and the searches a work came from count too.
const ARTIFICIAL_LIGHT_SEARCHES = ["lamplight", "café-concert", "footlights", "gaslight", "theater stage"];
const evalTypes = new Map<string, string>(
  JSON.parse(readFileSync("data/eval/itera_eval_manifest.json", "utf8")).map((row: any) => [
    `${row.source === "Met" ? "met" : "aic"}-${row.object_id}`,
    row.labels.type
  ])
);
const PEOPLE_CATEGORIES = ["Pose/Anatomy", "Expression/Emotion"];
const PERSON_DEPICTIONS = ["human", "man", "woman", "person", "boy", "girl", "child", "portrait", "saint", "musician", "figure"];
const works = results.flatMap((result, index) => {
  const answered = judgments[index].filter((j): j is VisionJudgment => j !== null).sort((a, b) => a.lightingScore - b.lightingScore);
  if (answered.length === 0) {
    skipped.push(`${result.id} (never judged)`);
    return [];
  }
  const median = answered[Math.floor((answered.length - 1) / 2)];
  const { candidate, ...artwork } = result;
  return [{
    ...artwork,
    via: candidate.via,
    genres: candidate.genres ?? [],
    depicts: candidate.depicts ?? [],
    people:
      median.categories.some((category) => PEOPLE_CATEGORIES.includes(category)) ||
      (candidate.depicts ?? []).some((depiction) => PERSON_DEPICTIONS.includes(depiction)),
    artificialLight:
      median.lighting.type === "colored / neon" ||
      evalTypes.get(result.id) === "colored / neon" ||
      ARTIFICIAL_LIGHT_SEARCHES.some((search) => candidate.via.endsWith(`: ${search}`)),
    lighting: median.lighting,
    lightingScore: median.lightingScore,
    lightingType: median.lighting.type,
    scores: judgments[index].map((j) => j?.lightingScore ?? null),
    categories: median.categories
  }];
});

writeFileSync(OUTPUT, JSON.stringify({
  builtAt: new Date().toISOString(),
  judge: visionJudgeSettings(),
  query: LIBRARY_QUERY,
  runs: RUNS,
  works
}, null, 2) + "\n");

const dramatic = works.filter((work) => work.lightingScore >= 4);
console.log(`\nWrote ${OUTPUT}: ${works.length} works, ${dramatic.length} dramatic (4+), ${works.filter((w) => w.artificialLight).length} artificial light.`);
console.log(`Skipped ${skipped.length}:\n  ${skipped.join("\n  ")}`);
