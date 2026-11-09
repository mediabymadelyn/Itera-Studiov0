/**
 * Task 4: judges every eligible manifest row with the app's own vision
 * judge (judgeResultImages in lib/search/visionJudge.ts, the same call
 * search makes) using the row's test_query and the provenance-checked image,
 * RUNS times each to measure consistency. Raw output goes to
 * data/eval/runs/{timestamp}.jsonl (gitignored); report.mts summarizes it.
 *
 * Eligible = manifest eval_allowed AND provenance eval_allowed. Unsplash
 * rows are also skipped by source as a second guard, until Unsplash
 * confirms AI analysis is allowed.
 *
 *   npm run eval:provenance   (first, once)
 *   npm run eval:run [-- --runs 3 --only M01,A03]
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import {
  LIGHTING_TYPES as JUDGE_LIGHTING_TYPES,
  clearJudgmentCache,
  isVisionJudgeEnabled,
  judgeResultImages,
  visionJudgeSettings
} from "../../lib/search/visionJudge";
import type { ArtworkResult } from "../../lib/types/artwork";
import { LIGHTING_TYPES, loadManifest, loadProvenance } from "./manifest.mts";
import type { ManifestRow, ProvenanceRow } from "./manifest.mts";

const RUNS_DIR = "data/eval/runs";
const DEFAULT_RUNS = 3;
// Images judged at once. Lower than a real search (about 36), so the eval
// measures the model's answers rather than timeouts under load; timeouts
// are still recorded (judgment: null) and counted in the report.
const CONCURRENCY = 6;

const SOURCE_LABELS: Record<string, string> = {
  Met: "The Metropolitan Museum of Art",
  AIC: "Art Institute of Chicago"
};

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function git(command: string): string {
  try {
    return execSync(`git ${command}`, { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** The result the app would build for this work, as the judge sees it. */
function toResult(row: ManifestRow, provenance: ProvenanceRow): ArtworkResult {
  return {
    id: `${row.source.toLowerCase()}-${row.object_id}`,
    title: provenance.api_title ?? row.title,
    artist: row.artist,
    source: SOURCE_LABELS[row.source],
    imageUrl: provenance.image_url!,
    thumbnailUrl: provenance.thumbnail_url ?? provenance.image_url!,
    originalLink: row.page_url,
    // Decides whether the painting rule applies, as it does in search.
    classification: provenance.classification ?? undefined
  };
}

async function mapLimited<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await worker(items[index]);
      }
    })
  );
  return results;
}

// The eval's lighting types must be the judge's, or agreement is skewed.
// Categories may differ: the labels keep the original nine, and the report
// compares only the ones the app still uses.
if (!sameList(LIGHTING_TYPES, JUDGE_LIGHTING_TYPES)) {
  console.error("scripts/eval/manifest.mts lighting types no longer match the app's. Update them first.");
  process.exit(1);
}
if (!isVisionJudgeEnabled()) {
  console.error("GEMINI_API_KEY is not set (expected in .env.local).");
  process.exit(1);
}

const runs = Number(argValue("runs") ?? DEFAULT_RUNS);
const only = argValue("only")?.split(",");
const provenanceById = new Map(loadProvenance().map((row) => [row.id, row]));
const rows = loadManifest().filter(
  (row) =>
    row.eval_allowed &&
    row.source !== "Unsplash" &&
    provenanceById.get(row.id)?.eval_allowed === true &&
    (!only || only.includes(row.id))
);

const startedAt = new Date();
const meta = {
  started_at: startedAt.toISOString(),
  git_commit: git("rev-parse --short HEAD"),
  git_dirty: git("status --porcelain -- lib components app") !== "",
  settings: visionJudgeSettings(),
  runs,
  concurrency: CONCURRENCY
};
mkdirSync(RUNS_DIR, { recursive: true });
const outPath = `${RUNS_DIR}/${startedAt.toISOString().replace(/[:.]/g, "-")}.jsonl`;
writeFileSync(outPath, JSON.stringify({ type: "meta", ...meta }) + "\n");

console.log(`Judging ${rows.length} rows x ${runs} runs with ${meta.settings.model} (prompt v${meta.settings.promptVersion}), commit ${meta.git_commit}${meta.git_dirty ? " + uncommitted app changes" : ""}`);

let missing = 0;
for (let run = 1; run <= runs; run++) {
  // Each run must ask the model again, not reuse the previous run's answers.
  clearJudgmentCache();
  await mapLimited(rows, CONCURRENCY, async (row) => {
    const result = toResult(row, provenanceById.get(row.id)!);
    const started = Date.now();
    const judgment = (await judgeResultImages([result], row.test_query)).get(result.id) ?? null;
    if (!judgment) missing++;
    appendFileSync(
      outPath,
      JSON.stringify({
        type: "judgment",
        run,
        id: row.id,
        test_query: row.test_query,
        image_url: result.thumbnailUrl,
        elapsed_ms: Date.now() - started,
        judgment
      }) + "\n"
    );
  });
  console.log(`  run ${run}/${runs} done`);
}

console.log(`\n${rows.length * runs - missing}/${rows.length * runs} judged (${missing} with no answer: timeout, download failure or unparseable).`);
console.log(`Wrote ${outPath}\nNext: npm run eval:report`);
