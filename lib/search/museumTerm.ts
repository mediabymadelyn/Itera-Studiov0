import { callModel, fastModel } from "@/lib/search/llmQueryLayer";
import { isDemographicWord, isFillerWord, tokenize } from "@/lib/search/queryTerms";

// Museums catalog works in their own words, and searching them with the
// user's finds little: "draped fabric" found two studio photos where
// "drapery study" finds the drapery drawings artists learn from. A few
// subjects have hand-tested terms (queryTerms.ts SUBJECT_SYNONYMS); for the
// rest, the fast model suggests one. Its term is only ever an extra museum
// search next to the user's own words, never a replacement, so a poor
// suggestion can only add candidates for the vision check to reject.

const MUSEUM_TERM_TIMEOUT_MS = 2500;
const MAX_TERM_WORDS = 3;
const CACHE_MAX_SIZE = 500;
const cache = new Map<string, string | null>();

function buildPrompt(query: string): string {
  return (
    `An artist searched an art-reference tool for: "${query}".\n` +
    `How would a museum's collection catalog title or describe artworks that show this? ` +
    `Reply with ONLY 1-${MAX_TERM_WORDS} words, the way museums write them, or "" if the ` +
    `search words already are museum terms. Examples: "draped fabric" -> "drapery study"; ` +
    `"dynamic pose" -> "figure study"; "face" -> "portrait"; "people at a cafe" -> "cafe scene". ` +
    `Never add a gender, age or ethnicity the search doesn't name. No other text.`
  );
}

/** Keeps only a short, plain term that adds no demographic words. */
function cleanTerm(raw: string, query: string): string | null {
  const term = raw.replace(/["'`.]/g, "").trim().toLowerCase();
  const words = tokenize(term);
  if (words.length === 0 || words.length > MAX_TERM_WORDS) return null;
  // A cut-off answer ("figure with") isn't a term.
  if (isFillerWord(words[words.length - 1])) return null;

  const queryWords = new Set(tokenize(query));
  if (words.some((word) => isDemographicWord(word) && !queryWords.has(word))) return null;
  // The user's own words already get searched.
  if (words.every((word) => queryWords.has(word))) return null;
  return words.join(" ");
}

/**
 * The museum-catalog way to say this search, or null (no key, slow model,
 * nothing different to add). Never throws.
 */
export async function museumTermFor(query: string): Promise<string | null> {
  const key = query.trim().toLowerCase();
  if (cache.has(key)) return cache.get(key) ?? null;

  const content = await callModel(buildPrompt(query), 20, MUSEUM_TERM_TIMEOUT_MS, fastModel());
  const term = content ? cleanTerm(content, query) : null;

  if (cache.size >= CACHE_MAX_SIZE) cache.clear();
  cache.set(key, term);
  return term;
}
