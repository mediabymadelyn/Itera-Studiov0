# Fields the museum adapters currently discard

Task 3 of the lighting & composition eval. A proposal only: nothing below
has been changed in `lib/sources/met.ts` or `lib/sources/aic.ts` yet.
Sample values are from The Penitent Magdalen (Met 436839) and Cupid
Chastised (AIC 59847), as returned on 2026-11-06.

## Met (`lib/sources/met.ts`)

Already kept: title, artist, images, page URL, `isPublicDomain` (as
`licenseType`), highlight flag, nationality, Wikidata ID, `tags`, medium,
classification, culture, date.

| Field | Sample | Why keep it |
|---|---|---|
| `creditLine` | "Gift of Mr. and Mrs. Charles Wrightsman, 1978" | The Met's own acquisition credit; shows full provenance on the card or expanded view. |
| `department` | "European Paintings" | Explains where a work comes from (e.g. the non-Western department searches), and a cheap filter. |
| `objectName` | "Painting" | Cleaner than `classification` for the painting / print / sculpture checks. |
| `artistDisplayBio` | "French, Vic-sur-Seille 1593–1652 Lunéville" | Fuller attribution than the name alone. |
| `objectBeginDate` / `objectEndDate` | 1635 / 1645 | Numeric dates for sorting or filtering by period. |
| `artistWikidata_URL` | Q203371 | Artist-level Wikidata lookup, already used work-level for dramatic light. |
| `accessionNumber` | "1978.517" | The museum's own ID, for citations. |

## AIC (`lib/sources/aic.ts`)

Already kept: title, `artist_display`, `is_public_domain`, subject / style /
technique / theme titles, description, short description, place of origin,
artwork type.

These aren't in `AIC_FIELDS`, so the API never sends them:

| Field | Sample | Why keep it |
|---|---|---|
| `credit_line` | "Charles H. and Mary F. S. Worcester Collection" | Provenance credit. |
| `date_display`, `artist_title` | "1613", "Bartolomeo Manfredi" | Needed for the credit AIC asks for: "Artist. Title, Date. The Art Institute of Chicago." Cards show no date today. |
| `thumbnail.alt_text` | "Large painting of cupid being whipped, a woman tries to hold back the a man in red dress." | Staff-written visual description. Better text for the subject filter than titles, and sometimes describes the light. |
| `classification_titles`, `material_titles`, `term_titles` | "oil on canvas", "european painting", "cupids", "Renaissance" | Expert subject and medium terms; would have helped the subject filter and medium checks. |
| `medium_display` | "Oil on canvas" | AIC's equivalent of the Met's `medium`, missing today. |
| `image_id` | "0f951635-…" | Confirms AIC has an image even when the Commons copy is missing. |
| `copyright_notice` | null | A second signal that a work is safe to show. |

## License on every result

Every result already carries `licenseType`, but museum works that aren't
public domain show "Unknown". In practice none reach the page: the Met
returns no image for them, and AIC works are only shown when they're public
domain, since only those get a Commons lookup. Keeping `creditLine` /
`credit_line` and showing "Public Domain (CC0)" plus the credit would make
the license explicit on every card.
