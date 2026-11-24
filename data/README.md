# Research data

Where to find the data behind the Itera Studio paper.

| Folder or file | What it holds |
|---|---|
| [user-study/](user-study/) | Anonymous System Usability Scale (SUS) answers from 8 participants |
| [model-comparison/](model-comparison/) | The 40-image test comparing Gemma and Gemini |
| [eval/](eval/) | The 38-work lighting evaluation: labels (`itera_eval_manifest.json`), and a report and CSV of every judgment for each version (`reports/`) |
| `test-queries.json`, `keyword-baseline-results.csv` | Earlier keyword-search tests |
| `blip-eval-input*.json` | Inputs for an earlier image-description test ([notes](../docs/blip-caption-eval.md)) |

`eval/` and the earlier test files stay where they are because scripts read
them by path. Interview recordings and notes are not included, to protect
participants' privacy.
