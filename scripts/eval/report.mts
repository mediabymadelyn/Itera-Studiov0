/**
 * Task 5: compares an eval run (data/eval/runs/*.jsonl, latest by default)
 * with the manifest labels and writes a markdown report plus a CSV with one
 * line per row and run, to data/eval/reports/.
 *
 * The "expected" lighting score comes from applying the app's own rule
 * (lightingScoreFor in lib/search/visionJudge.ts) to the labeled parts, so
 * score agreement tests the model's parts, not a reimplementation. Dramatic
 * agreement uses the direct yes/no verdict (labels.dramatic), and a
 * separate section checks the rule itself against that verdict.
 *
 *   npm run eval:report [-- data/eval/runs/<file>.jsonl]
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { MATCH_REASON_CATEGORIES } from "../../lib/search/categories";
import { isPaintedResult, lightingScoreFor } from "../../lib/search/visionJudge";
import type { VisionJudgment } from "../../lib/search/visionJudge";
import { judgeSourceCount, loadManifest, loadProvenance } from "./manifest.mts";
import type { ManifestRow } from "./manifest.mts";

const RUNS_DIR = "data/eval/runs";
const REPORTS_DIR = "data/eval/reports";
const DRAMATIC_SCORE = 4;
// From the handoff (CLAUDE_CODE_HANDOFF.md, Task 5).
const HARD_NEGATIVES = ["M02", "M04", "M11", "A13", "A17"];
const FAIRNESS_DARKER = ["M09", "A09", "M02", "U06"];
const FAIRNESS_LIGHTER = ["M05", "A07"];

type Judged = { run: number; judgment: VisionJudgment | null; elapsed_ms: number };

const runPath = process.argv[2] ?? `${RUNS_DIR}/${readdirSync(RUNS_DIR).filter((f) => f.endsWith(".jsonl")).sort().at(-1)}`;
const lines = readFileSync(runPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
const meta = lines.find((line) => line.type === "meta");
const manifest = loadManifest();
const rowById = new Map(manifest.map((row) => [row.id, row]));

const judgedById = new Map<string, Judged[]>();
for (const line of lines.filter((line) => line.type === "judgment")) {
  const list = judgedById.get(line.id) ?? [];
  list.push({ run: line.run, judgment: line.judgment, elapsed_ms: line.elapsed_ms });
  judgedById.set(line.id, list.sort((a, b) => a.run - b.run));
}
const rows = manifest.filter((row) => judgedById.has(row.id));
const classificationById = new Map(loadProvenance().map((row) => [row.id, row.classification]));
// Categories the app still uses; label categories outside these (dropped
// from the app) aren't counted against the model.
const appCategory = (category: string) => (MATCH_REASON_CATEGORIES as readonly string[]).includes(category);

function expectedScore(row: ManifestRow): number {
  const labels = row.labels;
  const painted = isPaintedResult({ source: row.source, classification: classificationById.get(row.id) ?? undefined });
  return lightingScoreFor({
    sources: judgeSourceCount(labels.sources),
    quality: labels.quality,
    direction: labels.direction,
    shadow: labels.shadow,
    type: labels.type,
    contrast: labels.contrast,
    readable: labels.readable
  }, { painted });
}

type Pair = { row: ManifestRow; run: number; judgment: VisionJudgment; elapsed_ms: number };
const pairs: Pair[] = rows.flatMap((row) =>
  judgedById.get(row.id)!.flatMap((judged) => (judged.judgment ? [{ row, ...judged, judgment: judged.judgment }] : []))
);
const missing = rows.flatMap((row) =>
  judgedById.get(row.id)!.filter((judged) => !judged.judgment).map((judged) => `${row.id} (run ${judged.run}, ${judged.elapsed_ms}ms)`)
);

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${Math.round((100 * n) / d)}%`);
const count = (predicate: (pair: Pair) => boolean) => pairs.filter(predicate).length;
const jaccard = (a: string[], b: string[]) => {
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 1 : a.filter((value) => b.includes(value)).length / union.size;
};
const table = (header: string[], body: (string | number)[][]) =>
  [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...body.map((cells) => `| ${cells.join(" | ")} |`)].join("\n");
const short = (row: ManifestRow) => `${row.id} ${row.title.length > 38 ? `${row.title.slice(0, 36)}…` : row.title}`;
const scoresOf = (row: ManifestRow) => judgedById.get(row.id)!.map((judged) => judged.judgment?.lightingScore ?? "–").join(" / ");

function disagreements(label: (row: ManifestRow) => string, model: (judgment: VisionJudgment) => string, top = 8): string {
  const counts = new Map<string, number>();
  for (const pair of pairs) {
    const want = label(pair.row);
    const got = model(pair.judgment);
    if (want !== got) counts.set(`${want} → ${got}`, (counts.get(`${want} → ${got}`) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
  return sorted.length ? sorted.map(([key, n]) => `${key} (${n})`).join("; ") : "none";
}

const out: string[] = [];
out.push(`# Itera lighting eval: ${basename(runPath, ".jsonl")}`);
out.push(
  `Model **${meta.settings.model}**, prompt v${meta.settings.promptVersion}, ${meta.settings.mediaResolution}, thinking ${meta.settings.thinkingLevel}, ` +
    `${meta.settings.timeoutMs}ms timeout. Commit \`${meta.git_commit}\`${meta.git_dirty ? " plus uncommitted app changes" : ""}. ` +
    `${rows.length} rows × ${meta.runs} runs = ${rows.length * meta.runs} judgments; **${pairs.length} answered**, ${missing.length} without an answer.`
);
if (missing.length) out.push(`No answer (timeout, download failure or unparseable): ${missing.join(", ")}.`);
out.push(`Unsplash rows are excluded (held until Unsplash confirms AI analysis is allowed).`);

// --- Per-field agreement -----------------------------------------------------
out.push(`\n## Agreement with your labels, per part\nOver every answered judgment (row × run).`);
const n = pairs.length;
const shadowExact = count((p) => p.judgment.lighting.shadow === p.row.labels.shadow);
const shadowNear = count((p) => Math.abs(p.judgment.lighting.shadow - p.row.labels.shadow) <= 1);
// Temperature is compared on color images only; monochrome rows are scored
// as black and white instead.
const colorPairs = pairs.filter((p) => !p.row.labels.color_temp.startsWith("n/a"));
const jaccards = pairs.map((p) => jaccard(p.row.labels.categories.filter(appCategory), p.judgment.categories));
out.push(
  table(["Part", "Agreement", "Most common disagreements (label → model)"], [
    ["Sources (1 / 2 / 3+ or ambient)", pct(count((p) => p.judgment.lighting.sources === judgeSourceCount(p.row.labels.sources)), n), disagreements((r) => String(judgeSourceCount(r.labels.sources)), (j) => String(j.lighting.sources))],
    ["Quality (hard / soft)", pct(count((p) => p.judgment.lighting.quality === p.row.labels.quality), n), disagreements((r) => r.labels.quality, (j) => j.lighting.quality)],
    ["Direction", pct(count((p) => p.judgment.lighting.direction === p.row.labels.direction), n), disagreements((r) => r.labels.direction, (j) => j.lighting.direction)],
    ["Shadow, exact", pct(shadowExact, n), disagreements((r) => String(r.labels.shadow), (j) => String(j.lighting.shadow))],
    ["Shadow, within 1", pct(shadowNear, n), ""],
    ["Type", pct(count((p) => p.judgment.lighting.type === p.row.labels.type), n), disagreements((r) => r.labels.type, (j) => j.lighting.type, 6)],
    ["Contrast (low / medium / high)", pct(count((p) => p.judgment.lighting.contrast === p.row.labels.contrast), n), disagreements((r) => r.labels.contrast, (j) => j.lighting.contrast)],
    ["Readable (yes / partly / no)", pct(count((p) => p.judgment.lighting.readable === p.row.labels.readable), n), disagreements((r) => r.labels.readable, (j) => j.lighting.readable)],
    ["Color temperature (your color_temp)", pct(colorPairs.filter((p) => p.judgment.color?.temperature === p.row.labels.color_temp).length, colorPairs.length), `${disagreements((r) => r.labels.color_temp, (j) => j.color?.temperature ?? "none")}; calling everything warm would get ${pct(colorPairs.filter((p) => p.row.labels.color_temp === "warm").length, colorPairs.length)}`],
    ["Black and white (your monochrome rows)", pct(pairs.filter((p) => (p.row.labels.color_temp.startsWith("n/a")) === (p.judgment.color?.saturation === "black and white")).length, n), ""],
    ["Categories, any overlap", pct(jaccards.filter((value) => value > 0).length, n), `mean overlap (Jaccard) ${(jaccards.reduce((a, b) => a + b, 0) / Math.max(1, n)).toFixed(2)}`]
  ])
);

// --- Shadow confusion -------------------------------------------------------
out.push(`\n### Shadow: your label (rows) vs model (columns)`);
out.push(
  table(["label \\ model", "0", "1", "2", "3"], [0, 1, 2, 3].map((want) => [
    String(want),
    ...[0, 1, 2, 3].map((got) => count((p) => p.row.labels.shadow === want && p.judgment.lighting.shadow === got))
  ]))
);

// --- Score and dramatic -----------------------------------------------------
const scoreExact = count((p) => p.judgment.lightingScore === expectedScore(p.row));
const scoreNear = count((p) => Math.abs(p.judgment.lightingScore - expectedScore(p.row)) <= 1);
const meanAbs = pairs.reduce((sum, p) => sum + Math.abs(p.judgment.lightingScore - expectedScore(p.row)), 0) / Math.max(1, n);
const isDramatic = (score: number) => score >= DRAMATIC_SCORE;
const verdict = (row: ManifestRow) => row.labels.dramatic === "yes";
const flag = (row: ManifestRow) => (row.labels.dramatic_by === "claude" && row.labels.dramatic_confidence === "low" ? " (verdict unsure)" : "");
const tp = count((p) => verdict(p.row) && isDramatic(p.judgment.lightingScore));
const fn = count((p) => verdict(p.row) && !isDramatic(p.judgment.lightingScore));
const fp = count((p) => !verdict(p.row) && isDramatic(p.judgment.lightingScore));
const tn = count((p) => !verdict(p.row) && !isDramatic(p.judgment.lightingScore));
out.push(`\n## Lighting score (0–5) and dramatic (4+)`);
out.push(`Your expected score is the app's rule applied to your labeled parts. Score exact ${pct(scoreExact, n)}, within 1 ${pct(scoreNear, n)}, mean difference ${meanAbs.toFixed(2)}.`);
out.push(`Dramatic uses the yes/no verdict column. Verdicts marked \`dramatic_by: claude\` are proposals awaiting review.`);
out.push(table(["", "Model: dramatic", "Model: not dramatic"], [["**Verdict: dramatic**", tp, fn], ["**Verdict: not dramatic**", fp, tn]]));
out.push(`Dramatic agreement ${pct(tp + tn, n)}. Missed dramatic: ${fn}. Called dramatic wrongly: ${fp}.`);
const wrongRows = rows.filter((row) => judgedById.get(row.id)!.some((j) => j.judgment && isDramatic(j.judgment.lightingScore) !== verdict(row)));
if (wrongRows.length) {
  out.push(table(["Row", "Verdict", "Model score per run", "Model parts (run 1)"], wrongRows.map((row) => {
    const first = judgedById.get(row.id)!.find((j) => j.judgment)?.judgment;
    return [short(row) + flag(row), row.labels.dramatic, scoresOf(row),
      first ? `${first.lighting.sources} · ${first.lighting.quality} · ${first.lighting.direction} · ${first.lighting.shadow} · ${first.lighting.type}` : "–"];
  })));
}

// --- The rule itself ------------------------------------------------------------
const ruleMisses = manifest.filter((row) => isDramatic(expectedScore(row)) !== verdict(row));
out.push(`\n## Does the rule agree with the verdict, using your own parts?`);
out.push(`No model involved: your labeled parts through the app's rule, against the yes/no verdict, for all ${manifest.length} rows (Unsplash included). ` +
  `${manifest.length - ruleMisses.length}/${manifest.length} agree. A disagreement here means the rule, not the model, needs changing (or the verdict does).`);
if (ruleMisses.length) {
  out.push(table(["Row", "Verdict", "Rule score from your parts", "Your parts (src · quality · dir · shadow · type)"], ruleMisses.map((row) => {
    const l = row.labels;
    return [short(row) + flag(row), l.dramatic, expectedScore(row), `${l.sources} · ${l.quality} · ${l.direction} · ${l.shadow} · ${l.type}`];
  })));
}

// --- Match -------------------------------------------------------------------
const matchCounts = [0, 1, 2].map((value) => count((p) => p.judgment.match === value));
out.push(`\n## Match against each row's test query\n2: ${matchCounts[2]}, 1: ${matchCounts[1]}, 0: ${matchCounts[0]}. Every row was chosen to fit its query, so a 0 means the image would be dropped from that search.`);
const matchZero = rows.filter((row) => judgedById.get(row.id)!.some((judged) => judged.judgment?.match === 0));
if (matchZero.length) out.push(table(["Row", "Test query", "Match per run"], matchZero.map((row) => [short(row), row.test_query, judgedById.get(row.id)!.map((j) => j.judgment?.match ?? "–").join(" / ")])));

// --- Consistency -------------------------------------------------------------
const unstable = rows.filter((row) => {
  const answers = judgedById.get(row.id)!.map((judged) => judged.judgment).filter((j): j is VisionJudgment => Boolean(j));
  const differs = (key: (j: VisionJudgment) => unknown) => new Set(answers.map(key)).size > 1;
  return differs((j) => j.lightingScore) || differs((j) => j.lighting.shadow) || differs((j) => j.lighting.type) || differs((j) => j.match);
});
out.push(`\n## Consistency across the ${meta.runs} runs\n${rows.length - unstable.length}/${rows.length} rows gave the same score, shadow, type and match every run.`);
if (unstable.length) {
  out.push(
    table(["Row", "Score per run", "Dramatic flips?", "Shadow per run", "Type per run", "Match per run"], unstable.map((row) => {
      const answers = judgedById.get(row.id)!;
      const scores = answers.map((a) => a.judgment?.lightingScore).filter((s): s is number => s !== undefined);
      return [
        short(row),
        scoresOf(row),
        new Set(scores.map(isDramatic)).size > 1 ? "**yes**" : "no",
        answers.map((a) => a.judgment?.lighting.shadow ?? "–").join(" / "),
        answers.map((a) => a.judgment?.lighting.type ?? "–").join(" / "),
        answers.map((a) => a.judgment?.match ?? "–").join(" / ")
      ];
    }))
  );
}

// --- Readability --------------------------------------------------------------
const hardToRead = rows.filter((row) => row.labels.readable !== "yes");
out.push(`\n## Readability: rows you marked partly or not readable\nThe rule takes a point off partly readable images and caps unreadable ones at 2.`);
out.push(table(["Row", "Readable", "Model readable per run", "Your expected score", "Model score per run", "Scored 4+?"], hardToRead.map((row) => [
  short(row), row.labels.readable, judgedById.get(row.id)!.map((j) => j.judgment?.lighting.readable ?? "–").join(" / "), expectedScore(row), scoresOf(row),
  judgedById.get(row.id)!.some((j) => (j.judgment?.lightingScore ?? 0) >= DRAMATIC_SCORE) ? "**yes**" : "no"
])));

// --- Hard negatives -----------------------------------------------------------
out.push(`\n## Hard negatives (should not be dramatic)`);
out.push(table(["Row", "Test group", "Model score per run", "Model type (run 1)", "Called dramatic?"], HARD_NEGATIVES.filter((id) => judgedById.has(id)).map((id) => {
  const row = rowById.get(id)!;
  const answers = judgedById.get(id)!;
  return [short(row), row.test_group, scoresOf(row), answers[0].judgment?.lighting.type ?? "–",
    answers.some((a) => (a.judgment?.lightingScore ?? 0) >= DRAMATIC_SCORE) ? "**yes**" : "no"];
})));

// --- Fairness pilot -----------------------------------------------------------
out.push(`\n## Fairness pilot (not a result)\nOnly ${[...FAIRNESS_DARKER, ...FAIRNESS_LIGHTER].filter((id) => judgedById.has(id)).length} rows, so this can only show whether to look closer, not whether there is a bias. The question: does the model put more shadow on darker skin than you labeled? U06 is Unsplash and excluded for now.`);
const fairnessRows = (ids: string[], group: string) => ids.filter((id) => judgedById.has(id)).map((id) => {
  const row = rowById.get(id)!;
  const shadows = judgedById.get(id)!.map((j) => j.judgment?.lighting.shadow).filter((s): s is 0 | 1 | 2 | 3 => s !== undefined);
  const meanShadow = shadows.reduce((a, b) => a + b, 0) / Math.max(1, shadows.length);
  return [group, short(row), row.labels.shadow, shadows.join(" / "), (meanShadow - row.labels.shadow).toFixed(2), expectedScore(row), scoresOf(row)];
});
out.push(table(["Group", "Row", "Your shadow", "Model shadow per run", "Model − you", "Your expected score", "Model score per run"], [
  ...fairnessRows(FAIRNESS_DARKER, "darker skin"),
  ...fairnessRows(FAIRNESS_LIGHTER, "lighter skin")
]));

// --- Every row ----------------------------------------------------------------
out.push(`\n## Every row`);
out.push(table(["Row", "Test group", "Your parts (src · quality · dir · shadow · type)", "Expected", "Model per run", "Model parts (run 1)"], rows.map((row) => {
  const l = row.labels;
  const first = judgedById.get(row.id)!.find((j) => j.judgment)?.judgment;
  const parts = first ? `${first.lighting.sources} · ${first.lighting.quality} · ${first.lighting.direction} · ${first.lighting.shadow} · ${first.lighting.type}` : "–";
  return [short(row), row.test_group, `${l.sources} · ${l.quality} · ${l.direction} · ${l.shadow} · ${l.type}`, expectedScore(row), scoresOf(row), parts];
})));

// --- CSV ------------------------------------------------------------------------
const csvCell = (value: unknown) => {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const csvHeader = [
  "id", "source", "title", "test_group", "test_query", "run", "elapsed_ms",
  "label_sources", "model_sources", "label_quality", "model_quality", "label_direction", "model_direction",
  "label_shadow", "model_shadow", "label_type", "model_type", "label_contrast", "model_contrast", "model_readable",
  "expected_score", "model_score",
  "rule_dramatic", "verdict_dramatic", "verdict_confidence", "verdict_by", "model_dramatic", "match", "label_readable", "label_categories", "model_categories", "category_jaccard"
];
const csvRows = rows.flatMap((row) => judgedById.get(row.id)!.map((judged) => {
  const j = judged.judgment;
  const l = row.labels;
  return [
    row.id, row.source, row.title, row.test_group, row.test_query, judged.run, judged.elapsed_ms,
    l.sources, j?.lighting.sources, l.quality, j?.lighting.quality, l.direction, j?.lighting.direction,
    l.shadow, j?.lighting.shadow, l.type, j?.lighting.type, l.contrast, j?.lighting.contrast, j?.lighting.readable,
    expectedScore(row), j?.lightingScore,
    isDramatic(expectedScore(row)), l.dramatic, l.dramatic_confidence, l.dramatic_by, j ? isDramatic(j.lightingScore) : "", j?.match, l.readable,
    l.categories, j?.categories, j ? jaccard(l.categories, j.categories).toFixed(2) : ""
  ].map(csvCell).join(",");
}));

mkdirSync(REPORTS_DIR, { recursive: true });
const stem = `${REPORTS_DIR}/${basename(runPath, ".jsonl")}`;
writeFileSync(`${stem}.md`, out.join("\n\n") + "\n");
writeFileSync(`${stem}.csv`, [csvHeader.join(","), ...csvRows].join("\n") + "\n");
console.log(`Wrote ${stem}.md and ${stem}.csv`);
