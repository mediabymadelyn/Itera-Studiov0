# Visual Tag Re-Ranking (experimental)

Follow-on to [docs/blip-caption-eval.md](blip-caption-eval.md). Wired into the
real search pipeline, behind a flag that defaults **off**.

## What it does

After `searchAllArtworks` ranks, dedupes, and slices to the final top N
results, [lib/search/visualTagBoost.ts](../lib/search/visualTagBoost.ts) asks
a vision LLM to tag each of those N images with lighting direction/quality,
contrast, mood, and composition ([lib/search/visualTags.ts](../lib/search/visualTags.ts)),
then re-sorts that same set using a small boost for tags that match words in
the query.

**Scope limitation, by design:** only the already-selected top N are tagged
(cost/latency control), so this can only **reorder** the shown results — it
can never pull in a better-matching result that didn't already make the cut.
If that turns out to matter, the next iteration is tagging a larger
candidate pool before the final slice.

**The lighting rule** (from the eval verdict): `lighting_direction` only
contributes to the score when the model didn't say `"unclear"` **and** its
own `confidence` is `>= 0.6`. `mood` and `composition` matches are trusted
generally, per the eval.

## Turning it on

```
ENABLE_VISUAL_SEARCH=true
HUGGINGFACE_API_KEY=hf_...        # or reuse BLIP_API_KEY from the eval setup
VISUAL_TAGS_MODEL=google/gemma-3-27b-it   # or reuse BLIP_MODEL; this is the default anyway
```

With the flag off (or no key configured), `applyVisualTagBoost` is a no-op —
zero extra requests, zero added latency, `visualTags` is absent from every
result. This is the default for anyone who clones the repo.

## Cost / latency

One chat-completions call per shown result, in parallel. At `limit=6`:
~$0.0002/search on `google/gemma-3-27b-it`, and adds a few seconds of
latency (each call has a 6s timeout; a slow/failed call just leaves that
result's score untouched rather than failing the search).

## Verifying it

```bash
ENABLE_VISUAL_SEARCH=false npm run dev   # baseline order, fast
ENABLE_VISUAL_SEARCH=true  npm run dev   # re-ranked order, ~3-7s
```

Then compare `/api/search?q=...` for the same query. A query with obvious
visual-treatment language ("dramatic", "chiaroscuro", "golden hour",
"diagonal") is the case this is meant to move the needle on; a query with
none of that vocabulary should barely change order (only mood-word overlaps
can still nudge it).

## Next, if this proves out

- A/B against keyword-only ranking on the 15 queries in
  [data/test-queries.json](../data/test-queries.json).
- If reordering isn't enough and pulling in different candidates matters,
  tag a larger pre-slice candidate pool instead of just the final N.
- Cache tags by artwork id so repeat searches don't re-pay for the same
  image (see the "precompute" option considered and deferred when this was
  scoped).
