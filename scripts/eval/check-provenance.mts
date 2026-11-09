/**
 * Task 2, the "clean dataset" gate: confirms through each museum's own API
 * that every Met / AIC manifest row exists, is public domain, has an image
 * the app can actually use, and is the work the manifest names. Writes
 * data/eval/provenance_report.json; a failing row gets eval_allowed: false
 * plus its reasons there. The manifest itself is never edited, and no row is
 * dropped: every row appears in the report, Unsplash ones marked as held.
 *
 * Polite by design: one request at a time, ~1/s to the Met (its CDN blocks
 * bursts far below its stated 80/s), a short pause for AIC, an identifying
 * User-Agent, and every response cached in data/eval/cache/ (gitignored) so
 * reruns cost nothing. Delete a cache file to re-check that row.
 *
 *   npm run eval:provenance
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fetchAicCommonsImages } from "../../lib/sources/wikidataAicImages";
import { PROVENANCE_PATH, loadManifest } from "./manifest.mts";
import type { ManifestRow, ProvenanceRow } from "./manifest.mts";

const CACHE_DIR = "data/eval/cache";
const USER_AGENT = "IteraStudioEval/1.0 (art-reference research evaluation; non-commercial)";
const MET_DELAY_MS = 1000;
const AIC_DELAY_MS = 400;
// Below this share of the manifest title's words found in the API's title,
// the row is flagged: likely a wrong object ID.
const TITLE_MATCH_MIN = 0.6;
const AIC_FIELDS =
  "id,title,artist_display,artist_title,date_display,image_id,is_public_domain,credit_line,main_reference_number";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type CachedResponse = { status: number; body: any };

async function cachedGet(cacheKey: string, url: string, headers: Record<string, string>, delayMs: number): Promise<CachedResponse> {
  const cachePath = `${CACHE_DIR}/${cacheKey}.json`;
  if (existsSync(cachePath)) return JSON.parse(readFileSync(cachePath, "utf8")) as CachedResponse;

  await sleep(delayMs);
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, ...headers } });
  const text = await response.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const result = { status: response.status, body };
  // Rate-limit and server errors aren't facts about the artwork: don't
  // cache them, so the next run tries again.
  if (response.status < 500 && response.status !== 403 && response.status !== 429) {
    writeFileSync(cachePath, JSON.stringify(result));
  }
  return result;
}

const STOPWORDS = new Set(["the", "a", "an", "of", "and", "with", "in", "on", "at", "by", "his", "her", "de", "la", "le"]);

function titleWords(title: string): string[] {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word && !STOPWORDS.has(word));
}

/** Share of the manifest title's words that appear in the API title (0-1). */
function titleMatch(manifestTitle: string, apiTitle: string): number {
  const wanted = titleWords(manifestTitle);
  if (wanted.length === 0) return 0;
  const have = new Set(titleWords(apiTitle));
  return Number((wanted.filter((word) => have.has(word)).length / wanted.length).toFixed(2));
}

function baseRow(row: ManifestRow): ProvenanceRow {
  return {
    id: row.id,
    source: row.source,
    object_id: row.object_id,
    checked_at: new Date().toISOString(),
    checks: { exists: false, public_domain: null, has_image: false, title_match: null },
    api_title: null,
    image_url: null,
    thumbnail_url: null,
    credit_line: null,
    eval_allowed: false,
    reasons: []
  };
}

function finish(result: ProvenanceRow, row: ManifestRow): ProvenanceRow {
  const { checks, reasons } = result;
  if (!row.eval_allowed) reasons.unshift(`manifest: ${row.eval_blocker ?? "eval_allowed is false"}`);
  if (checks.exists && checks.public_domain === false) reasons.push("API says not public domain");
  if (checks.exists && !checks.has_image && !reasons.some((reason) => reason.includes("image"))) {
    reasons.push("no usable image");
  }
  if (checks.title_match !== null && checks.title_match < TITLE_MATCH_MIN) {
    reasons.push(`title mismatch (${checks.title_match}): API title is "${result.api_title}"`);
  }
  result.reasons = reasons.filter(Boolean);
  result.eval_allowed = row.eval_allowed && checks.exists && checks.public_domain === true && checks.has_image &&
    (checks.title_match ?? 0) >= TITLE_MATCH_MIN;
  return result;
}

async function checkMet(row: ManifestRow): Promise<ProvenanceRow> {
  const result = baseRow(row);
  const response = await cachedGet(`met-${row.object_id}`, row.api_url, {}, MET_DELAY_MS);
  if (response.status !== 200 || !response.body?.objectID) {
    result.reasons.push(
      response.status === 403 ? "Met API returned 403 (rate block; not a fact about the work, rerun later)" : `Met API returned HTTP ${response.status}`
    );
    return result;
  }
  const object = response.body;
  result.checks.exists = true;
  result.checks.public_domain = object.isPublicDomain === true;
  result.checks.has_image = Boolean(object.primaryImage);
  result.api_title = object.title ?? null;
  result.checks.title_match = titleMatch(row.title, object.title ?? "");
  result.image_url = object.primaryImage || null;
  result.thumbnail_url = object.primaryImageSmall || object.primaryImage || null;
  result.credit_line = object.creditLine ?? null;
  if (!result.checks.has_image) result.reasons.push("Met returns no primaryImage (usually still in copyright)");
  return result;
}

async function checkAicRows(rows: ManifestRow[]): Promise<ProvenanceRow[]> {
  const results: ProvenanceRow[] = [];
  const references = new Map<string, string>();

  for (const row of rows) {
    const result = baseRow(row);
    const url = `https://api.artic.edu/api/v1/artworks/${row.object_id}?fields=${AIC_FIELDS}`;
    const response = await cachedGet(`aic-${row.object_id}`, url, { "AIC-User-Agent": USER_AGENT }, AIC_DELAY_MS);
    const item = response.body?.data;
    if (response.status !== 200 || !item?.id) {
      result.reasons.push(`AIC API returned HTTP ${response.status}`);
      results.push(result);
      continue;
    }
    result.checks.exists = true;
    result.checks.public_domain = item.is_public_domain === true;
    result.api_title = item.title ?? null;
    result.checks.title_match = titleMatch(row.title, item.title ?? "");
    // The credit form AIC asks for: "Artist. Title, Date. The Art Institute of Chicago."
    const artist = item.artist_title || item.artist_display?.split("\n")[0] || "Unknown artist";
    result.credit_line = `${artist}. ${item.title}, ${item.date_display}. The Art Institute of Chicago.`;
    if (!item.image_id) result.reasons.push("AIC has no image_id");
    if (item.main_reference_number) references.set(row.id, item.main_reference_number);
    results.push(result);
  }

  // Same lookup the app uses (lib/sources/wikidataAicImages.ts): AIC's own
  // image host blocks apps, so a row only counts as having an image when a
  // Wikimedia Commons copy exists. Cached as one file per manifest version.
  const commonsCachePath = `${CACHE_DIR}/aic-commons.json`;
  let commons: Record<string, string>;
  if (existsSync(commonsCachePath)) {
    commons = JSON.parse(readFileSync(commonsCachePath, "utf8"));
  } else {
    commons = Object.fromEntries(await fetchAicCommonsImages([...references.values()]));
    writeFileSync(commonsCachePath, JSON.stringify(commons));
  }

  for (const result of results) {
    const reference = references.get(result.id);
    const commonsImage = reference ? commons[reference] : undefined;
    if (commonsImage) {
      result.checks.has_image = true;
      result.image_url = `${commonsImage}?width=843`;
      result.thumbnail_url = `${commonsImage}?width=400`;
    } else if (result.checks.exists) {
      result.reasons.push("no Wikimedia Commons copy found (the app can't show AIC's own images)");
    }
  }
  return results;
}

mkdirSync(CACHE_DIR, { recursive: true });
const manifest = loadManifest();
const byId = new Map(manifest.map((row) => [row.id, row]));
const report: ProvenanceRow[] = [];

for (const row of manifest.filter((row) => row.source === "Met")) {
  report.push(finish(await checkMet(row), row));
  process.stdout.write(".");
}
for (const result of await checkAicRows(manifest.filter((row) => row.source === "AIC"))) {
  report.push(finish(result, byId.get(result.id)!));
}
// Unsplash rows are listed, never fetched: held until Unsplash confirms.
for (const row of manifest.filter((row) => row.source === "Unsplash")) {
  report.push(finish(baseRow(row), row));
}
console.log();

report.sort((a, b) => manifest.indexOf(byId.get(a.id)!) - manifest.indexOf(byId.get(b.id)!));
writeFileSync(PROVENANCE_PATH, JSON.stringify(report, null, 2) + "\n");

const museum = report.filter((row) => row.source !== "Unsplash");
const passed = museum.filter((row) => row.eval_allowed);
console.log(`Museum rows: ${passed.length}/${museum.length} pass. Unsplash: ${report.length - museum.length} held.`);
const failed = museum.filter((row) => !row.eval_allowed);
if (failed.length > 0) {
  console.log("\nNot eligible (review these):");
  for (const row of failed) console.log(`  ${row.id} ${byId.get(row.id)!.title}: ${row.reasons.join("; ")}`);
}
const weakTitles = passed.filter((row) => (row.checks.title_match ?? 1) < 1);
if (weakTitles.length > 0) {
  console.log("\nPassed, but titles differ slightly (check these are the right works):");
  for (const row of weakTitles) {
    console.log(`  ${row.id} (${row.checks.title_match}) manifest "${byId.get(row.id)!.title}" / API "${row.api_title}"`);
  }
}
console.log(`\nWrote ${PROVENANCE_PATH}`);
