# Visual-Treatment Description — Metadata Gap Experiment

## Question

Met and AIC metadata describe *what* a work is (title, artist, date, medium,
classification) but not its **visual treatment** — lighting direction, mood,
compositional structure. Can a hosted vision model fill that gap well enough to
be worth wiring into search?

This is a throwaway evaluation. Nothing here touches the search pipeline.

## Why a prompted vision LLM instead of BLIP

BLIP was the first idea, but:

- Hugging Face's serverless API no longer hosts `Salesforce/blip-image-captioning-large`
  (`inferenceProviderMapping: {}` — no provider serves it), and
- BLIP-large only emits terse literal captions ("a painting of a field with
  mountains"); it almost never names lighting direction or compositional
  structure, which is exactly what this eval measures.

So the script defaults to a **prompted vision LLM** on the HF Inference Providers
router (`/v1/chat/completions`), reusing the same HF token. The script still
supports the raw BLIP request styles (`binary`, `json-image-url`, `json-base64`)
if you point it at a real BLIP endpoint later.

## Step 1 — Generate descriptions

1. Add credentials to `.env.local` (git-ignored):

   ```
   BLIP_API_KEY=hf_your_token_here
   BLIP_API_URL=https://router.huggingface.co/v1/chat/completions
   BLIP_REQUEST_FORMAT=chat-completions
   BLIP_MODEL=google/gemma-3-27b-it
   # Alt models: Qwen/Qwen2.5-VL-72B-Instruct, zai-org/GLM-4.5V
   # BLIP_PROMPT=...            # override the default instruction
   # BLIP_IMAGE_MODE=base64     # if the provider can't fetch images.metmuseum.org
   ```

   Cost is pay-as-you-go but tiny (~$0.00004/image on gemma-3-27b) and covered by
   HF's small monthly free credit for a signed-in account — fine for a prototype.
   All env keys and their defaults are documented in the header of
   [scripts/blip-caption-eval.mts](../scripts/blip-caption-eval.mts). For a
   differently shaped API, set `BLIP_REQUEST_FORMAT`, `BLIP_RESPONSE_PATH`, and
   the field-name vars to match it.

2. Put image URLs in [data/blip-eval-input.json](../data/blip-eval-input.json).
   The file accepts a plain array of URL strings **or** an array of objects with
   an `imageUrl` field — so you can paste `ArtworkResult` rows straight out of
   the app's `/api/search` response. See
   [data/blip-eval-input.example.json](../data/blip-eval-input.example.json).

   Pick images you *expect* to exemplify the qualities below, plus a few that
   clearly do not, as controls.

3. Run:

   ```
   npm run eval:blip                          # uses data/blip-eval-input.json
   npm run eval:blip -- path/to/other.json    # a different input file
   npm run eval:blip -- --limit 5             # first 5 only
   npm run eval:blip -- --stdout-only         # skip the CSV
   ```

   Output: one line per image on the console, plus
   `data/blip-eval-output.csv` (git-ignored) with columns
   `index, label, image_url, caption, status, http_status, attempts, elapsed_ms, error`
   (the `caption` column holds the model's description).

## Step 2 — Judge the descriptions by hand

For each description, decide whether it actually captures the visual treatment,
not just the subject. Score each target quality:

- **2** — names the quality specifically and correctly
- **1** — gestures at it vaguely ("dark", "bright")
- **0** — silent on it, or wrong

### Test queries

| # | Query | What the caption would need to convey |
|---|-------|--------------------------------------|
| 1 | dramatic lighting from below | strong directional light, upward shadows, theatrical contrast |
| 2 | golden hour | warm low sun, long shadows, amber cast |
| 3 | diagonal composition | dominant diagonal lines, dynamic tilt |
| 4 | high-contrast chiaroscuro | deep shadow with a bright focal area |
| 5 | soft diffused window light | gentle even light, soft-edged shadows |
| 6 | centered symmetrical framing | subject centered, balanced left/right |
| 7 | silhouette against bright background | dark subject, blown-out backdrop |
| 8 | moody overcast atmosphere | flat grey light, subdued mood |
| 9 | rim / backlighting | bright outline around the subject |
| 10 | shallow depth of field | sharp subject, blurred background |

### Tally sheet

Two passes were run: 18 museum works ([data/blip-eval-input.json](../data/blip-eval-input.json),
mostly paintings/prints where lighting is often genuinely absent) and 13 photos
chosen so lighting is unambiguous ([data/blip-eval-input-lighting.json](../data/blip-eval-input-lighting.json),
each tagged with a ground-truth `probe`). Full outputs:
[data/blip-eval-output.csv](../data/blip-eval-output.csv),
[data/blip-eval-output-lighting.csv](../data/blip-eval-output-lighting.csv).

Models/modes compared: `google/gemma-3-27b-it` prose, `Qwen/Qwen2.5-VL-72B-Instruct`
prose, `google/gemma-3-27b-it` structured (`BLIP_MODE=structured`).

**Lighting set, scored against each row's `probe`:**

| confidence band | rows | lighting_direction + quality + contrast correct |
|---|---|---|
| ≥ 0.8 | 8 of 13 | 8 / 8 |
| ≤ 0.6 | 5 of 13 | 1 clear miss (#4), rest correctly hedge (`unclear` or low-signal `diffuse/flat`) |

Re-run twice for stability: every `confidence ≥ 0.8` row was identical or moved
≤ 0.1 across runs; the two rows that visibly drifted were both already in the
≤ 0.6 band.

### Verdict

- Descriptions capture visual treatment reliably enough to build on: **yes**, with a rule (below).
- Which qualities the model handles well: **composition** (orientation, symmetry, dominant lines, framing) and **mood** are reliable in both prose and structured mode. **Lighting** is reliable in structured mode specifically when `lighting_direction != "unclear"` — the model only commits to a direction when it's actually sure, and every committed call in the lighting-explicit set was correct and reproducible.
- Which it misses entirely: prose mode defaults to "soft diffused light" as a filler phrase (not reliable). `depth` (flat/shallow/moderate/deep) carries almost no signal — drop it. `composition[]` occasionally emits self-contradictory tags (e.g. "high key" + "low key") — needs a light sanitize pass. `notes` leaks medium/style words despite being told not to — treat as unused.
- Model / prompt tried: `google/gemma-3-27b-it` beat `Qwen/Qwen2.5-VL-72B-Instruct` (Qwen was more templated and bluffed lighting more, not less). Structured JSON output (enum values + `confidence` + an explicit `"unclear"` option) beat free-text prose — prose never admits uncertainty, structured mode does and the uncertainty is trustworthy.
- Next step: prototype using `lighting_direction` (gated on non-`unclear`), `mood[]`, and a sanitized `composition[]` as a ranking signal in `lib/search/rankResults.ts`, behind a flag, A/B'd against the current keyword-only ranking on the 15 queries in `data/test-queries.json`. Scope that as its own task — this eval is closed.
