import { ArtworkResult } from "@/lib/types/artwork";
import { QueryPlan } from "@/lib/search/queryPlan";
import {
  ageGroupMatchWords,
  detectAgeGroup,
  hasAnyWord,
  isObjectResult,
  resultWords,
  subjectSynonyms
} from "@/lib/search/queryTerms";

// Results that never mention the main subject are what testers called
// "clearly irrelevant" (Adam & Eve for "cat in the jungle jumping on a
// tree"). Keyword search returns them because some OTHER word matched
// ("tree"), so this requires the subject itself.

// Below this many verified results, unverified ones are kept (ranked lower)
// rather than leaving a near-empty page.
const MIN_VERIFIED_RESULTS = 6;
// An Unsplash result with less text than this can't be judged from text at
// all -- but Unsplash's own search matched it using its visual index, so it
// is kept with a small penalty instead of being dropped.
const SPARSE_TEXT_WORD_COUNT = 8;
const SPARSE_PENALTY = 0.1;
const UNVERIFIED_PENALTY = 0.3;
// Results showing only the action (a person mid-backflip for "hedgehog
// doing a backflip") are useful pose references for the hard-to-find part
// of a compound query, but they shouldn't outrank or outnumber results that
// show what was actually asked for.
const MAX_ACTION_ONLY_RESULTS = 3;
const ACTION_ONLY_PENALTY = 0.3;

function subjectMatchWords(plan: QueryPlan): string[] {
  // Head noun of the subject: "coffee cup" -> "cup". A tea cup is still a
  // cup; requiring "coffee" too would drop good results with sparse text.
  const head = plan.subjectWords[plan.subjectWords.length - 1];
  if (!head) return [];

  const ageGroup = detectAgeGroup([head]);
  return [head, ...subjectSynonyms(head), ...(ageGroup ? ageGroupMatchWords(ageGroup) : [])];
}

// People nouns ending in -er are usually captioned by what they're doing:
// a "dancer" photo says "man dancing", a "skater" photo says "skating". So
// "dancer" also accepts any word starting with "danc". Needs a stem of at
// least 4 letters, which keeps short words like "her"/"tower" out of it.
const AGENT_NOUN_MIN_STEM = 4;

function agentNounStem(plan: QueryPlan): string | null {
  const head = plan.subjectWords[plan.subjectWords.length - 1];
  if (!head || !head.endsWith("er")) return null;

  const stem = head.slice(0, -2).replace(/(.)\1$/, "$1");
  return stem.length >= AGENT_NOUN_MIN_STEM ? stem : null;
}

type Verdict = "verified" | "actionOnly" | "sparse" | "unverified";

function judge(result: ArtworkResult, plan: QueryPlan, subjectWords: string[]): Verdict {
  const words = resultWords(result);

  if (hasAnyWord(words, subjectWords)) return "verified";

  // Body-part searches: museum catalogs name the scene ("Young Peasant
  // Having Her Coffee"), not the hands, so naming what the hands hold or do
  // counts too. The vision check then confirms the hands from the image.
  if (plan.companionWords.length > 0 && hasAnyWord(words, plan.companionWords)) return "verified";

  const stem = agentNounStem(plan);
  if (stem && Array.from(words).some((word) => word.startsWith(stem))) return "verified";

  // The action-only fallback search exists to return pose references for
  // the hard-to-find part of a compound query, so those are kept (capped)
  // when they show the action.
  if (
    result.retrievedVia === "secondary" &&
    plan.actionWords.length > 0 &&
    hasAnyWord(words, plan.actionWords)
  ) {
    return "actionOnly";
  }

  if (result.source === "Unsplash" && words.size < SPARSE_TEXT_WORD_COUNT) {
    return "sparse";
  }

  // From the pre-scored museum library (museumLibrary.ts), which already
  // matched the subject from the work's depictions; catalog titles often
  // name only the light ("Candlelight"). Kept like sparse results; the
  // vision check confirms the subject from the image.
  if (result.retrievedVia === "lighting") return "sparse";

  return "unverified";
}

function withPenalty(result: ArtworkResult, penalty: number): ArtworkResult {
  return { ...result, score: Number(((result.score ?? 0) - penalty).toFixed(4)) };
}

export function applySubjectRequirement(
  results: ArtworkResult[],
  plan: QueryPlan,
  // Strict: never fall back to unverified results. For extras that fill a
  // category, where an unrelated image ("colorful spinning wheels" for a
  // dancer) is worse than leaving the category empty.
  options: { strict?: boolean } = {}
): ArtworkResult[] {
  const subjectWords = subjectMatchWords(plan);
  if (subjectWords.length === 0) return results;

  const verified: ArtworkResult[] = [];
  const actionOnly: ArtworkResult[] = [];
  const sparse: ArtworkResult[] = [];
  const unverified: ArtworkResult[] = [];

  for (const result of results) {
    const verdict = judge(result, plan, subjectWords);
    if (verdict === "verified") verified.push(result);
    else if (verdict === "actionOnly") actionOnly.push(withPenalty(result, ACTION_ONLY_PENALTY));
    else if (verdict === "sparse") sparse.push(withPenalty(result, SPARSE_PENALTY));
    else unverified.push(withPenalty(result, UNVERIFIED_PENALTY));
  }

  const kept = options.strict
    ? verified
    : [...verified, ...actionOnly.slice(0, MAX_ACTION_ONLY_RESULTS), ...sparse];
  if (!options.strict && verified.length < MIN_VERIFIED_RESULTS) kept.push(...unverified);

  return kept.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

// Testers said "maybe 1-2 is fine" for statues/objects when they never
// asked for one, so beyond this many, lower-scored objects are dropped.
const MAX_OBJECT_RESULTS = 2;

export function capObjectResults(results: ArtworkResult[], plan: QueryPlan): ArtworkResult[] {
  if (plan.allowsObjects) return results;

  const maxObjects = plan.namesFlatMedium ? 0 : MAX_OBJECT_RESULTS;
  let objectsKept = 0;
  return results.filter((result) => {
    if (!isObjectResult(result)) return true;
    objectsKept++;
    return objectsKept <= maxObjects;
  });
}
