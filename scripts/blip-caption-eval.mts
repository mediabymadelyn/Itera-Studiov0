/**
 * Standalone image-caption / visual-description evaluation script.
 *
 * This is NOT wired into the search pipeline. It exists to answer one question
 * before any further work: can a hosted caption / vision model describe
 * visual-treatment qualities (lighting, mood, composition) that the Met / AIC
 * metadata leaves out?
 *
 * Two request styles are supported:
 *   - a plain caption model (BLIP-style: raw bytes or a small JSON body), or
 *   - a prompted vision LLM via an OpenAI-compatible /chat/completions endpoint
 *     (BLIP_REQUEST_FORMAT=chat-completions). This is what actually produces
 *     lighting / mood / composition language; a bare caption model usually will
 *     not. The default config below targets a vision LLM on the Hugging Face
 *     Inference Providers router, reusing an HF token.
 *
 * Flow:
 *   1. Put credentials in .env.local (see env keys below) or export them.
 *   2. Fill data/blip-eval-input.json with image URLs (see shape below), or pass
 *      your own JSON file as the first argument.
 *   3. npm run eval:blip -- [inputFile] [--out file.csv] [--limit N] [--stdout-only]
 *   4. Review the descriptions in the CSV against the test queries in
 *      docs/blip-caption-eval.md (step 2 of the experiment).
 *
 * Input file JSON may be either a plain array of URL strings:
 *   ["https://images.metmuseum.org/.../a.jpg", "https://.../b.jpg"]
 * or an array of objects (e.g. ArtworkResult rows copied straight from the app):
 *   [{ "imageUrl": "https://.../a.jpg", "id": "met-436535", "title": "Wheat Field" }]
 *
 * Env keys (all optional except the API key):
 *   BLIP_API_URL            caption / chat endpoint
 *                           (default: https://router.huggingface.co/v1/chat/completions)
 *   BLIP_API_KEY            bearer token / API key (an HF token for the default)
 *   BLIP_AUTH_SCHEME        Authorization header prefix (default: "Bearer")
 *   BLIP_REQUEST_FORMAT     "chat-completions" | "binary" | "json-image-url" | "json-base64"
 *                           (default: "chat-completions")
 *   BLIP_MODE               "prose" (free-text description, default) or
 *                           "structured" (discrete JSON tags: lighting_direction,
 *                           lighting_quality, contrast, depth, mood[], composition[],
 *                           confidence, notes -- with an "unclear" value allowed).
 *                           Structured mode changes the CSV columns.
 *   BLIP_JSON_MODE          structured mode: send response_format:{type:"json_object"}
 *                           (default: on; set to "0" if the provider rejects it)
 *   BLIP_MODEL              model id for chat-completions (default: "google/gemma-3-27b-it")
 *   BLIP_PROMPT             overrides the built-in prompt for the active BLIP_MODE
 *   BLIP_MAX_TOKENS         max response tokens (default: 200 prose / 300 structured)
 *   BLIP_IMAGE_MODE         chat-completions image delivery: "url" | "base64"
 *                           (default: "url" -- switch to base64 if the provider
 *                           cannot fetch the image host)
 *   BLIP_IMAGE_URL_FIELD    json-image-url mode: body field for the URL (default: "url")
 *   BLIP_IMAGE_BASE64_FIELD json-base64 mode: body field for the data URI (default: "image")
 *   BLIP_RESPONSE_PATH      dot path to the text in a JSON response
 *                           (default: "choices.0.message.content" for chat-completions,
 *                           else "0.generated_text")
 *   BLIP_EXTRA_HEADERS      JSON object of extra request headers, e.g.
 *                           '{"x-wait-for-model":"true"}' for HF cold starts
 *   BLIP_MAX_RETRIES        retries on 429 / 503 / "model loading" (default: 3)
 *   BLIP_RETRY_DELAY_MS     base backoff, multiplied by attempt number (default: 4000)
 *   BLIP_REQUEST_DELAY_MS   pause between images (default: 500)
 *
 * Run with: node --experimental-strip-types scripts/blip-caption-eval.mts
 * (wrapped by `npm run eval:blip`). No third-party dependencies.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type RequestFormat = "chat-completions" | "binary" | "json-image-url" | "json-base64";

type OutputMode = "prose" | "structured";

// BLIP_MODE=prose (default): free-text visual description.
const DEFAULT_PROMPT =
  "Describe only the visual treatment of this image in 2-3 sentences: the " +
  "direction and quality of the lighting, the overall mood or atmosphere, and " +
  "the compositional structure (framing, balance, dominant lines, depth). Do " +
  "not name or identify the subject matter, artist, or title. Reply with the " +
  "description only, no preamble.";

// BLIP_MODE=structured: discrete tags with an explicit "unclear" escape hatch,
// so a manual reviewer can see how often the model actually knows vs. bluffs.
const STRUCTURED_PROMPT =
  'Analyze only the visual treatment of this image and reply with a single ' +
  'minified JSON object and nothing else -- no markdown, no code fence, no ' +
  'commentary.\n\n' +
  'Keys and allowed values:\n' +
  '- "lighting_direction": one of "front","side-left","side-right","back","above","below","diffuse","unclear"\n' +
  '- "lighting_quality": one of "hard","soft","flat","mixed","unclear"\n' +
  '- "contrast": one of "low","medium","high","unclear"\n' +
  '- "depth": one of "flat","shallow","moderate","deep","unclear"\n' +
  '- "mood": array of 0-3 short lowercase adjectives (e.g. "serene","ominous","festive")\n' +
  '- "composition": array of 0-4 short lowercase phrases (e.g. "centered","symmetrical","strong diagonal","low horizon","tight framing","rule of thirds")\n' +
  '- "confidence": number 0 to 1 -- your confidence that lighting_direction and lighting_quality are genuinely determinable from this image\n' +
  '- "notes": one short sentence ONLY if a specific, clearly visible treatment is worth adding; otherwise ""\n\n' +
  'Rules:\n' +
  '- Use "unclear" whenever a flat reproduction does not let you determine a value honestly. Do not guess to fill a field.\n' +
  '- Do not describe or identify the subject, objects, people, artist, style, or title.\n' +
  '- Do not default to "soft diffused light"; only say "soft" if shadow edges are genuinely soft.\n' +
  '- Use "shallow"/"moderate"/"deep" for depth only if there is real spatial recession or focus falloff; otherwise "flat".';

type Entry = { imageUrl: string; label: string };

type Row = {
  index: number;
  label: string;
  imageUrl: string;
  caption: string;
  lightingDirection?: string;
  lightingQuality?: string;
  contrast?: string;
  depth?: string;
  confidence?: string;
  mood?: string;
  composition?: string;
  notes?: string;
  status: "ok" | "error";
  httpStatus: number;
  attempts: number;
  elapsedMs: number;
  error: string;
};

// Used only when no input file is given: a plumbing smoke test, not real eval data.
const SAMPLE_IMAGE_URLS = [
  "https://picsum.photos/seed/itera-lighting/900/700",
  "https://picsum.photos/seed/itera-mood/900/700",
  "https://picsum.photos/seed/itera-composition/900/700"
];

const REQUEST_FORMAT = (process.env.BLIP_REQUEST_FORMAT?.trim() || "chat-completions") as RequestFormat;
const MODE = (process.env.BLIP_MODE?.trim() || "prose") as OutputMode;

const CONFIG = {
  apiUrl:
    process.env.BLIP_API_URL?.trim() ||
    "https://router.huggingface.co/v1/chat/completions",
  apiKey: process.env.BLIP_API_KEY?.trim() || "",
  authScheme: process.env.BLIP_AUTH_SCHEME?.trim() || "Bearer",
  requestFormat: REQUEST_FORMAT,
  mode: MODE,
  jsonMode: process.env.BLIP_JSON_MODE !== "0" && process.env.BLIP_JSON_MODE !== "false",
  model: process.env.BLIP_MODEL?.trim() || "google/gemma-3-27b-it",
  prompt:
    process.env.BLIP_PROMPT?.trim() || (MODE === "structured" ? STRUCTURED_PROMPT : DEFAULT_PROMPT),
  maxTokens: intFromEnv("BLIP_MAX_TOKENS", MODE === "structured" ? 300 : 200),
  chatImageMode: (process.env.BLIP_IMAGE_MODE?.trim() || "url") as "url" | "base64",
  imageUrlField: process.env.BLIP_IMAGE_URL_FIELD?.trim() || "url",
  imageBase64Field: process.env.BLIP_IMAGE_BASE64_FIELD?.trim() || "image",
  responsePath:
    process.env.BLIP_RESPONSE_PATH?.trim() ||
    (REQUEST_FORMAT === "chat-completions" ? "choices.0.message.content" : "0.generated_text"),
  extraHeaders: parseJsonEnv("BLIP_EXTRA_HEADERS"),
  maxRetries: intFromEnv("BLIP_MAX_RETRIES", 3),
  retryDelayMs: intFromEnv("BLIP_RETRY_DELAY_MS", 4000),
  requestDelayMs: intFromEnv("BLIP_REQUEST_DELAY_MS", 500)
};

class RetryableError extends Error {}

// Auth / quota / billing failures: retrying or continuing the batch is pointless.
class FatalError extends Error {}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function parseJsonEnv(name: string): Record<string, string> {
  const raw = process.env[name];
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) out[k] = String(v);
      return out;
    }
  } catch {
    console.warn(`Ignoring invalid JSON in ${name}`);
  }
  return {};
}

const DEFAULT_INPUT = "data/blip-eval-input.json";

function parseArgs(argv: string[]) {
  const opts = {
    input: DEFAULT_INPUT,
    inputExplicit: false,
    out: "data/blip-eval-output.csv",
    limit: 0,
    stdoutOnly: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else if (a === "--out") {
      opts.out = argv[++i] ?? opts.out;
    } else if (a === "--limit") {
      opts.limit = Number.parseInt(argv[++i] ?? "0", 10) || 0;
    } else if (a === "--stdout-only") {
      opts.stdoutOnly = true;
    } else if (a.startsWith("--")) {
      console.warn(`Ignoring unknown flag: ${a}`);
    } else if (!opts.inputExplicit) {
      opts.input = a;
      opts.inputExplicit = true;
    }
  }
  return opts;
}

function printHelp(): void {
  console.log(
    [
      "Usage: npm run eval:blip -- [inputFile] [options]",
      "",
      "  inputFile        JSON array of image-URL strings, or of objects with an",
      "                   \"imageUrl\" field. Omit to run the built-in smoke test.",
      "",
      "  --out <path>     CSV output path (default: data/blip-eval-output.csv)",
      "  --limit <n>      only caption the first n images",
      "  --stdout-only    do not write a CSV file",
      "  --help           show this message",
      "",
      "Credentials and request shape are read from env vars (see the header",
      "comment in scripts/blip-caption-eval.mts)."
    ].join("\n")
  );
}

function toEntries(data: unknown): Entry[] {
  if (!Array.isArray(data)) return [];
  const entries: Entry[] = [];
  for (const item of data) {
    if (typeof item === "string") {
      if (item.trim()) entries.push({ imageUrl: item.trim(), label: "" });
      continue;
    }
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const url = [obj.imageUrl, obj.image, obj.url, obj.primaryImage].find(
        (v): v is string => typeof v === "string" && v.trim().length > 0
      );
      if (!url) continue;
      const label = [obj.id, obj.title].find(
        (v): v is string => typeof v === "string" && v.trim().length > 0
      );
      entries.push({ imageUrl: url.trim(), label: label ?? "" });
    }
  }
  return entries;
}

async function fetchImage(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "itera-studio-blip-eval/0.1", Accept: "image/*" }
    });
  } catch (err) {
    throw new RetryableError(
      `could not download image: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!res.ok) throw new Error(`image download failed: HTTP ${res.status} for ${url}`);
  const contentType = (res.headers.get("content-type") || "").split(";")[0].trim();
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error(`downloaded image is empty: ${url}`);
  return { bytes, contentType };
}

function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc == null) return undefined;
    if (Array.isArray(acc)) return acc[Number(key)];
    if (typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function deepFindString(obj: unknown, keys: string[], depth = 0): string | null {
  if (depth > 6 || obj == null) return null;
  if (Array.isArray(obj)) {
    for (const el of obj) {
      const found = deepFindString(el, keys, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (keys.includes(k) && typeof v === "string" && v.trim()) return v;
    }
    for (const v of Object.values(obj as Record<string, unknown>)) {
      const found = deepFindString(v, keys, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function extractCaption(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw.trim();
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const errVal = (parsed as Record<string, unknown>).error;
    if (errVal != null && errVal !== "") {
      const msg =
        typeof errVal === "string"
          ? errVal
          : typeof (errVal as Record<string, unknown>).message === "string"
            ? String((errVal as Record<string, unknown>).message)
            : JSON.stringify(errVal);
      if (/loading|warming|not ready/i.test(msg)) throw new RetryableError(`API: ${msg}`);
      throw new Error(`API error: ${msg}`);
    }
  }

  const byPath = getByPath(parsed, CONFIG.responsePath);
  if (typeof byPath === "string" && byPath.trim()) return byPath.trim();

  if (typeof parsed === "string" && parsed.trim()) return parsed.trim();

  const deep = deepFindString(parsed, [
    "generated_text",
    "caption",
    "content",
    "text",
    "output",
    "description"
  ]);
  return deep ? deep.trim() : "";
}

type Structured = {
  lighting_direction: string;
  lighting_quality: string;
  contrast: string;
  depth: string;
  confidence: string;
  mood: string[];
  composition: string[];
  notes: string;
};

function parseStructured(raw: string): Structured {
  let s = raw.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1].trim();
  if (!s.startsWith("{")) {
    const a = s.indexOf("{");
    const b = s.lastIndexOf("}");
    if (a >= 0 && b > a) s = s.slice(a, b + 1);
  }

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(s) as Record<string, unknown>;
  } catch {
    throw new Error(
      `model did not return valid JSON: ${raw.slice(0, 200).replace(/\s+/g, " ").trim()}`
    );
  }

  const str = (v: unknown, fallback = "unclear"): string =>
    typeof v === "string" && v.trim() ? v.trim().toLowerCase() : fallback;
  const arr = (v: unknown): string[] =>
    Array.isArray(v)
      ? v
          .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          .map((x) => x.trim().toLowerCase())
      : [];
  const conf = (v: unknown): string => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "";
  };

  return {
    lighting_direction: str(obj.lighting_direction),
    lighting_quality: str(obj.lighting_quality),
    contrast: str(obj.contrast),
    depth: str(obj.depth),
    confidence: conf(obj.confidence),
    mood: arr(obj.mood),
    composition: arr(obj.composition),
    notes: typeof obj.notes === "string" ? obj.notes.trim() : ""
  };
}

async function callBlip(imageUrl: string): Promise<{ caption: string; httpStatus: number }> {
  const headers: Record<string, string> = {};
  if (CONFIG.apiKey) headers.Authorization = `${CONFIG.authScheme} ${CONFIG.apiKey}`.trim();

  let body: string | Uint8Array;
  if (CONFIG.requestFormat === "chat-completions") {
    let imageUrlValue: string;
    if (CONFIG.chatImageMode === "base64") {
      const img = await fetchImage(imageUrl);
      imageUrlValue = `data:${img.contentType || "image/jpeg"};base64,${Buffer.from(
        img.bytes
      ).toString("base64")}`;
    } else {
      imageUrlValue = imageUrl;
    }
    headers["Content-Type"] = "application/json";
    const payload: Record<string, unknown> = {
      model: CONFIG.model,
      max_tokens: CONFIG.maxTokens,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: CONFIG.prompt },
            { type: "image_url", image_url: { url: imageUrlValue } }
          ]
        }
      ]
    };
    if (CONFIG.mode === "structured" && CONFIG.jsonMode) {
      payload.response_format = { type: "json_object" };
    }
    body = JSON.stringify(payload);
  } else if (CONFIG.requestFormat === "binary") {
    const img = await fetchImage(imageUrl);
    headers["Content-Type"] = img.contentType || "application/octet-stream";
    body = img.bytes;
  } else if (CONFIG.requestFormat === "json-image-url") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({ [CONFIG.imageUrlField]: imageUrl });
  } else if (CONFIG.requestFormat === "json-base64") {
    const img = await fetchImage(imageUrl);
    const dataUri = `data:${img.contentType || "image/jpeg"};base64,${Buffer.from(img.bytes).toString(
      "base64"
    )}`;
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({ [CONFIG.imageBase64Field]: dataUri });
  } else {
    throw new Error(`Unknown BLIP_REQUEST_FORMAT: ${CONFIG.requestFormat}`);
  }

  Object.assign(headers, CONFIG.extraHeaders);

  let res: Response;
  try {
    // Node's fetch accepts a Uint8Array body; the DOM lib's BodyInit type does not list it.
    res = await fetch(CONFIG.apiUrl, { method: "POST", headers, body: body as BodyInit });
  } catch (err) {
    throw new RetryableError(
      `network error calling caption API: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const text = await res.text();

  if (!res.ok) {
    const snippet = text.slice(0, 300).replace(/\s+/g, " ").trim();
    if (
      res.status === 401 ||
      res.status === 402 ||
      res.status === 403 ||
      /depleted|insufficient|quota|billing|payment required/i.test(text)
    ) {
      throw new FatalError(`HTTP ${res.status}: ${snippet}`);
    }
    if (res.status === 429 || res.status === 503 || /loading|warming|not ready|cold/i.test(text)) {
      throw new RetryableError(`HTTP ${res.status}: ${snippet}`);
    }
    throw new Error(`HTTP ${res.status}: ${snippet}`);
  }

  const caption = extractCaption(text);
  if (!caption) {
    throw new Error(
      `could not find caption text in response: ${text
        .slice(0, 300)
        .replace(/\s+/g, " ")
        .trim()}`
    );
  }
  return { caption, httpStatus: res.status };
}

async function captionWithRetry(
  imageUrl: string
): Promise<{ caption: string; attempts: number; httpStatus: number }> {
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= CONFIG.maxRetries + 1; attempt++) {
    try {
      const { caption, httpStatus } = await callBlip(imageUrl);
      return { caption, attempts: attempt, httpStatus };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (!(err instanceof RetryableError) || attempt > CONFIG.maxRetries) break;
      const wait = CONFIG.retryDelayMs * attempt;
      console.log(`      retry ${attempt}/${CONFIG.maxRetries} in ${wait}ms (${lastErr.message})`);
      await sleep(wait);
    }
  }
  throw lastErr ?? new Error("unknown captioning failure");
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Row[]): string {
  const structured = CONFIG.mode === "structured";
  const header = structured
    ? [
        "index",
        "label",
        "image_url",
        "lighting_direction",
        "lighting_quality",
        "contrast",
        "depth",
        "confidence",
        "mood",
        "composition",
        "notes",
        "status",
        "http_status",
        "attempts",
        "elapsed_ms",
        "error"
      ]
    : [
        "index",
        "label",
        "image_url",
        "caption",
        "status",
        "http_status",
        "attempts",
        "elapsed_ms",
        "error"
      ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const cells = structured
      ? [
          r.index,
          r.label,
          r.imageUrl,
          r.lightingDirection ?? "",
          r.lightingQuality ?? "",
          r.contrast ?? "",
          r.depth ?? "",
          r.confidence ?? "",
          r.mood ?? "",
          r.composition ?? "",
          r.notes ?? "",
          r.status,
          r.httpStatus,
          r.attempts,
          r.elapsedMs,
          r.error
        ]
      : [
          r.index,
          r.label,
          r.imageUrl,
          r.caption,
          r.status,
          r.httpStatus,
          r.attempts,
          r.elapsedMs,
          r.error
        ];
    lines.push(cells.map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  const inputPath = resolve(process.cwd(), opts.input);
  let entries: Entry[];
  if (existsSync(inputPath)) {
    entries = toEntries(JSON.parse(readFileSync(inputPath, "utf8")));
    if (entries.length === 0) {
      console.error(
        `No usable image URLs in ${opts.input}. Expected a JSON array of URL ` +
          `strings, or of objects with an "imageUrl" field.`
      );
      process.exit(1);
    }
  } else if (opts.inputExplicit) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  } else {
    console.warn(
      `${opts.input} not found -- using built-in SAMPLE_IMAGE_URLS (plumbing smoke test only).\n`
    );
    entries = SAMPLE_IMAGE_URLS.map((u) => ({ imageUrl: u, label: "sample" }));
  }

  if (opts.limit > 0) entries = entries.slice(0, opts.limit);

  if (!CONFIG.apiKey) {
    console.warn("BLIP_API_KEY is not set -- sending requests without an Authorization header.\n");
  }

  console.log(`Describing ${entries.length} image(s) via ${CONFIG.apiUrl}`);
  console.log(`Request format: ${CONFIG.requestFormat}   Output mode: ${CONFIG.mode}`);
  if (CONFIG.requestFormat === "chat-completions") {
    console.log(`Model: ${CONFIG.model}  (image as ${CONFIG.chatImageMode})`);
    console.log(`Prompt: ${CONFIG.prompt}`);
  }
  console.log("");

  const rows: Row[] = [];
  const startedAll = Date.now();
  let abortedAt = -1;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const tag = `[${i + 1}/${entries.length}]`;
    const started = Date.now();
    try {
      const { caption, attempts, httpStatus } = await captionWithRetry(entry.imageUrl);
      const elapsed = Date.now() - started;
      const row: Row = {
        index: i + 1,
        label: entry.label,
        imageUrl: entry.imageUrl,
        caption,
        status: "ok",
        httpStatus,
        attempts,
        elapsedMs: elapsed,
        error: ""
      };

      if (CONFIG.mode === "structured") {
        const st = parseStructured(caption);
        row.lightingDirection = st.lighting_direction;
        row.lightingQuality = st.lighting_quality;
        row.contrast = st.contrast;
        row.depth = st.depth;
        row.confidence = st.confidence;
        row.mood = st.mood.join("; ");
        row.composition = st.composition.join("; ");
        row.notes = st.notes;
        row.caption =
          `light=${st.lighting_direction}/${st.lighting_quality} contrast=${st.contrast} ` +
          `depth=${st.depth} conf=${st.confidence || "n/a"}`;
        console.log(`${tag} ok  ${elapsed}ms  ${entry.imageUrl}`);
        console.log(
          `      light ${st.lighting_direction} / ${st.lighting_quality}   contrast ${st.contrast}   ` +
            `depth ${st.depth}   confidence ${st.confidence || "n/a"}`
        );
        console.log(`      mood: ${st.mood.join(", ") || "-"}`);
        console.log(`      composition: ${st.composition.join(", ") || "-"}`);
        if (st.notes) console.log(`      notes: ${st.notes}`);
        console.log("");
      } else {
        console.log(`${tag} ok  ${elapsed}ms  ${entry.imageUrl}`);
        console.log(`      "${caption}"\n`);
      }

      rows.push(row);
    } catch (err) {
      const elapsed = Date.now() - started;
      const message = err instanceof Error ? err.message : String(err);
      rows.push({
        index: i + 1,
        label: entry.label,
        imageUrl: entry.imageUrl,
        caption: "",
        status: "error",
        httpStatus: 0,
        attempts: 0,
        elapsedMs: elapsed,
        error: message
      });
      console.log(`${tag} ERR ${elapsed}ms  ${entry.imageUrl}`);
      console.log(`      ${message}\n`);
      if (err instanceof FatalError) {
        abortedAt = i;
        console.log(
          `Aborting: ${entries.length - i - 1} image(s) not attempted ` +
            `(auth / quota / billing failure -- fix the account, then re-run).\n`
        );
        break;
      }
    }

    if (i < entries.length - 1 && CONFIG.requestDelayMs > 0) {
      await sleep(CONFIG.requestDelayMs);
    }
  }

  const okCount = rows.filter((r) => r.status === "ok").length;
  console.log("-".repeat(60));
  console.log(
    `Done: ${okCount} ok, ${rows.length - okCount} error` +
      (abortedAt >= 0 ? `, ${entries.length - abortedAt - 1} skipped` : "") +
      `, ${((Date.now() - startedAll) / 1000).toFixed(1)}s total`
  );

  if (!opts.stdoutOnly) {
    const outPath = resolve(process.cwd(), opts.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, toCsv(rows), "utf8");
    console.log(`CSV written to ${opts.out}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
