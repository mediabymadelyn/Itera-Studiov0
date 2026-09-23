import { VisualTags } from "@/lib/types/artwork";

// Prompted vision LLM on the HF Inference Providers router, validated in
// docs/blip-caption-eval.md. HF serverless does not host a plain BLIP model
// (inferenceProviderMapping is empty for blip-image-captioning-large), so
// this calls a chat-completions endpoint with an image + a structured prompt
// instead. `depth` and `notes` were tested and dropped: no usable signal.
const VISUAL_TAGS_API_URL = "https://router.huggingface.co/v1/chat/completions";

const STRUCTURED_PROMPT =
  "Analyze only the visual treatment of this image and reply with a single " +
  "minified JSON object and nothing else -- no markdown, no code fence, no " +
  "commentary.\n\n" +
  "Keys and allowed values:\n" +
  '- "lighting_direction": one of "front","side-left","side-right","back","above","below","diffuse","unclear"\n' +
  '- "lighting_quality": one of "hard","soft","flat","mixed","unclear"\n' +
  '- "contrast": one of "low","medium","high","unclear"\n' +
  '- "mood": array of 0-3 short lowercase adjectives\n' +
  '- "composition": array of 0-4 short lowercase phrases (e.g. "centered","symmetrical","strong diagonal","low horizon","tight framing","rule of thirds")\n' +
  '- "confidence": number 0 to 1 -- your confidence that lighting_direction and lighting_quality are genuinely determinable from this image\n\n' +
  "Rules:\n" +
  '- Use "unclear" whenever a flat reproduction does not let you determine a value honestly. Do not guess to fill a field.\n' +
  "- Do not describe or identify the subject, objects, people, artist, style, or title.\n" +
  '- Do not default to "soft diffused light"; only say "soft" if shadow edges are genuinely soft.';

const REQUEST_TIMEOUT_MS = 6000;

function apiKey(): string {
  return process.env.HUGGINGFACE_API_KEY?.trim() || process.env.BLIP_API_KEY?.trim() || "";
}

function model(): string {
  return (
    process.env.VISUAL_TAGS_MODEL?.trim() ||
    process.env.BLIP_MODEL?.trim() ||
    "google/gemma-3-27b-it"
  );
}

export function isVisualSearchEnabled(): boolean {
  return process.env.ENABLE_VISUAL_SEARCH === "true" && Boolean(apiKey());
}

type RawTags = {
  lighting_direction?: unknown;
  lighting_quality?: unknown;
  contrast?: unknown;
  mood?: unknown;
  composition?: unknown;
  confidence?: unknown;
};

function toLowerString(value: unknown, fallback = "unclear"): string {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : fallback;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim().toLowerCase());
}

function toConfidence(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null;
}

function parseTags(raw: string): VisualTags | null {
  let text = raw.trim();

  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) text = fence[1].trim();

  if (!text.startsWith("{")) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) text = text.slice(start, end + 1);
  }

  let parsed: RawTags;
  try {
    parsed = JSON.parse(text) as RawTags;
  } catch {
    return null;
  }

  return {
    lightingDirection: toLowerString(parsed.lighting_direction),
    lightingQuality: toLowerString(parsed.lighting_quality),
    contrast: toLowerString(parsed.contrast),
    mood: toStringArray(parsed.mood),
    composition: toStringArray(parsed.composition),
    confidence: toConfidence(parsed.confidence)
  };
}

/**
 * Describes the lighting/mood/composition of an image via a hosted vision
 * LLM. Never throws -- returns null on any failure (missing key, network
 * error, timeout, bad response) so a tagging failure never breaks search.
 */
export async function describeVisualTags(imageUrl: string): Promise<VisualTags | null> {
  const key = apiKey();
  if (!key || !imageUrl) {
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(VISUAL_TAGS_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model(),
        max_tokens: 220,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: STRUCTURED_PROMPT },
              { type: "image_url", image_url: { url: imageUrl } }
            ]
          }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;

    return content ? parseTags(content) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
