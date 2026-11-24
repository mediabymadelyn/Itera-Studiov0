# Model comparison: 40 images

Run on 2026-11-01, after user testing, to choose a vision model. Every model
saw every image, with its title, source and search, and judged it twice.

- `test_images.csv`: the 40 images and their labels. No image files are
  included. Titles longer than 50 characters were cut off when recorded.
- `results_summary.csv`: results per model. Blank cells were not recorded.

## Labels
Claude (an AI assistant) labeled the images by looking at them before the
models were run.

- Relevance: 16 images (7 relevant, 9 irrelevant), 32 judgments per model.
- Lighting: 21 images (13 lit, 8 flat), 42 judgments per model.
- Images 1, 3 and 18 have no label.

## Scoring
Lighting was one score from 0 to 5: 4 or more counts as dramatic, 2 or less as
flat, and 3 as neither (wrong either way).

## What was missed
- Gemma 3 27B accepted irrelevant images 29, 30, 31 and 33 in both runs.
- Gemini 3.8 Flash misjudged image 31 in one of its two runs.
- Gemini 3.5 Flash-Lite misjudged image 30 in both runs.
- Gemma 4 31B failed 77 of 80 calls, mostly by timing out, so it has no results.

## Limits
- **The answers for each image were not saved.** These results come from the
  scores printed when the test ran, so they can't be recalculated from this
  folder.
- Two runs of one image are not independent examples.
- This test used an earlier prompt with one lighting score. The current app
  asks for the parts of the light instead.

## Prompt
    An artist searched an art-reference tool for: "{search}".
    This result is titled "{title}" by {artist} ({source}).
    Look at the image itself and reply with ONLY JSON:
    {"relevant": true|false, "lighting": 0-5, "categories": [...]}
    - relevant: would this image genuinely serve as a reference for the search (right subject and what was asked about it)? A 3D object, textile, or unrelated thing that only shares a word with the search is not relevant.
    - lighting: how dramatic and directional the light is: 0 = flat, even light; 3 = clear light and shadow; 5 = strong chiaroscuro / low-key light against deep shadow.
    - categories: 1-3 of ["Pose/Anatomy","Lighting","Color Palette","Composition","Style/Technique","Texture/Material","Expression/Emotion","Environment/Setting","Historical/Cultural Reference"] that this image is most useful for as a reference.
