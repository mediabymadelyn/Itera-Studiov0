/**
 * Task 1: checks every manifest row against the allowed shape and values,
 * with no network. Exits non-zero on any problem, listing all of them (not
 * just the first), then prints row counts by source and test group.
 *
 *   npm run eval:validate
 */
import {
  CATEGORIES,
  CONFIDENCE,
  DIRECTIONS,
  LABELERS,
  LIGHT_SOURCES,
  LIGHTING_TYPES,
  QUALITIES,
  SOURCES,
  YES_NO,
  YES_PARTLY_NO,
  loadManifest
} from "./manifest.mts";

const REQUIRED_STRINGS = [
  "id", "object_id", "title", "artist", "date", "test_group", "test_query",
  "composition", "page_url", "api_url", "rights_expected", "review_status"
] as const;

function oneOf(value: unknown, allowed: readonly unknown[]): boolean {
  return allowed.includes(value);
}

function isUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function checkRow(row: Record<string, any>): string[] {
  const problems: string[] = [];
  const fail = (message: string) => problems.push(message);

  for (const field of REQUIRED_STRINGS) {
    if (typeof row[field] !== "string" || row[field].trim() === "") fail(`missing or empty "${field}"`);
  }
  if (!oneOf(row.source, SOURCES)) fail(`source "${row.source}" not one of ${SOURCES.join(", ")}`);
  if (!oneOf(row.confidence, CONFIDENCE)) fail(`confidence "${row.confidence}" not one of ${CONFIDENCE.join(", ")}`);
  if (!isUrl(row.page_url)) fail(`page_url is not an https URL`);
  if (!isUrl(row.api_url)) fail(`api_url is not an https URL`);
  if (typeof row.eval_allowed !== "boolean") fail(`eval_allowed must be true or false`);
  if (row.eval_blocker !== null && typeof row.eval_blocker !== "string") fail(`eval_blocker must be a string or null`);
  if (row.eval_allowed === false && !row.eval_blocker) fail(`eval_allowed is false but eval_blocker gives no reason`);

  const labels = row.labels;
  if (!labels || typeof labels !== "object") {
    fail(`missing "labels"`);
    return problems;
  }
  if (!oneOf(labels.subject_visible, YES_PARTLY_NO)) fail(`labels.subject_visible "${labels.subject_visible}" not yes/partly/no`);
  if (!oneOf(labels.readable, YES_PARTLY_NO)) fail(`labels.readable "${labels.readable}" not yes/partly/no`);
  if (!oneOf(labels.sources, LIGHT_SOURCES)) fail(`labels.sources "${labels.sources}" not one of ${LIGHT_SOURCES.join(" | ")}`);
  if (!oneOf(labels.quality, QUALITIES)) fail(`labels.quality "${labels.quality}" not hard/soft`);
  if (!oneOf(labels.direction, DIRECTIONS)) fail(`labels.direction "${labels.direction}" not one of ${DIRECTIONS.join(", ")}`);
  if (!Number.isInteger(labels.shadow) || labels.shadow < 0 || labels.shadow > 3) fail(`labels.shadow ${JSON.stringify(labels.shadow)} not an integer 0-3`);
  if (!oneOf(labels.type, LIGHTING_TYPES)) fail(`labels.type "${labels.type}" not one of the ${LIGHTING_TYPES.length} lighting types`);
  if (!oneOf(labels.dramatic, YES_NO)) fail(`labels.dramatic "${labels.dramatic}" not yes/no`);
  if (!oneOf(labels.dramatic_confidence, CONFIDENCE)) fail(`labels.dramatic_confidence "${labels.dramatic_confidence}" not high/medium/low`);
  if (!oneOf(labels.dramatic_by, LABELERS)) fail(`labels.dramatic_by "${labels.dramatic_by}" not one of ${LABELERS.join(", ")}`);
  for (const field of ["pattern_proposed", "color_temp", "contrast"]) {
    if (typeof labels[field] !== "string") fail(`labels.${field} must be a string`);
  }
  if (!Array.isArray(labels.categories) || labels.categories.length < 1 || labels.categories.length > 3) {
    fail(`labels.categories must list 1-3 categories`);
  } else {
    for (const category of labels.categories) {
      if (!oneOf(category, CATEGORIES)) fail(`labels.categories has unknown "${category}"`);
    }
    if (new Set(labels.categories).size !== labels.categories.length) fail(`labels.categories repeats a category`);
  }
  return problems;
}

const rows = loadManifest() as unknown as Record<string, any>[];
const problems: string[] = [];

rows.forEach((row, index) => {
  for (const problem of checkRow(row)) problems.push(`${row.id ?? `row ${index}`}: ${problem}`);
});

const seenIds = new Map<string, number>();
const seenObjects = new Map<string, string>();
for (const row of rows) {
  seenIds.set(row.id, (seenIds.get(row.id) ?? 0) + 1);
  const objectKey = `${row.source}:${row.object_id}`;
  if (seenObjects.has(objectKey)) problems.push(`${row.id}: same ${objectKey} as ${seenObjects.get(objectKey)}`);
  else seenObjects.set(objectKey, row.id);
}
for (const [id, count] of seenIds) {
  if (count > 1) problems.push(`${id}: id used ${count} times`);
}

function countBy(key: (row: Record<string, any>) => string): [string, number][] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

console.log(`${rows.length} rows, ${rows.filter((row) => row.eval_allowed).length} eligible for Gemini (eval_allowed)`);
console.log("\nBy source:");
for (const [source, count] of countBy((row) => row.source)) console.log(`  ${source.padEnd(10)} ${count}`);
console.log("\nBy test group:");
for (const [group, count] of countBy((row) => row.test_group)) console.log(`  ${String(count).padStart(2)}  ${group}`);

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("\nManifest OK.");
