import { ArtworkResult } from "@/lib/types/artwork";
import { QueryPlan } from "@/lib/search/queryPlan";
import {
  adultWords,
  ageGroupMatchWords,
  containsPhrase,
  hasAnyWord,
  isObjectResult,
  looksBlurry,
  nearMissWords,
  resultText,
  tokenize,
  withoutEffectPhrases,
  wordMatchStrength
} from "@/lib/search/queryTerms";

const VAGUE_TITLE_PATTERN = /^(untitled|unknown|untitled photo|image)$/i;
const VAGUE_ARTIST_PATTERN = /^(unknown|unknown artist|unknown photographer)$/i;

// Matching is by whole word, not substring: substring matching let "cat"
// match "category"/"Catholic" and "face" match "surface". A plural query
// word only gets half credit from the singular form, so "hands" prefers
// results showing hands over a single hand (P1).
function sumWordMatches(words: Set<string>, keywords: string[]): number {
  return keywords.reduce((total, keyword) => total + wordMatchStrength(words, keyword), 0);
}

function sumListMatches(values: string[] | undefined, keywords: string[]): number {
  if (!values || values.length === 0) {
    return 0;
  }

  return sumWordMatches(new Set(tokenize(values.join(" "))), keywords);
}

// Adjacent query words appearing together ("coffee cup") beat the same
// words scattered across a description.
function computePhraseBonus(text: string, keywords: string[]): number {
  let bonus = 0;

  for (let i = 0; i < keywords.length - 1; i++) {
    if (containsPhrase(text, `${keywords[i]} ${keywords[i + 1]}`)) {
      bonus += 0.1;
    }
  }

  return Math.min(bonus, 0.2);
}

function computeIntentScore(result: ArtworkResult, plan: QueryPlan, words: Set<string>): number {
  let score = 0;

  if (plan.actionWords.length > 0 && hasAnyWord(words, plan.actionWords)) {
    score += 0.15;
  }

  // A stated setting is part of the request: "girl walking in the city"
  // shouldn't lead with a girl walking through rice fields (P6).
  if (plan.settingWords.length > 0) {
    score += hasAnyWord(words, plan.settingWords) ? 0.15 : -0.15;
  }

  // 3D objects rarely help with a pose/lighting/figure reference; see
  // capObjectResults in subjectFilter.ts for the matching hard cap.
  if (!plan.allowsObjects && isObjectResult(result)) {
    score -= 0.15;
  }

  // A blurred photo makes a pose unreadable as a reference (P2: "a more
  // stagnant one would be better"), unless blur is what was asked for.
  if (!plan.allowsBlur && looksBlurry(result)) {
    score -= 0.25;
  }

  if (plan.lighting) {
    if (hasAnyWord(words, plan.lighting.rankTerms)) score += 0.12;

    const artist = result.artist.toLowerCase();
    if (plan.lighting.rankArtists.some((name) => artist.includes(name))) score += 0.12;
  }

  // Literal age matching: "girl" should return children, not adult women
  // (P6). Only ever applied when the user typed an age word.
  if (plan.ageGroup) {
    const showsAgeGroup = hasAnyWord(words, ageGroupMatchWords(plan.ageGroup));
    if (showsAgeGroup) score += 0.08;
    else if (hasAnyWord(words, adultWords())) score -= 0.2;
  }

  // "coffee cup" returning mugs (P4): demote a near-miss object only when
  // the word the user actually typed is absent.
  for (const keyword of plan.rankWords) {
    const misses = nearMissWords(keyword);
    if (misses.length > 0 && wordMatchStrength(words, keyword) === 0 && hasAnyWord(words, misses)) {
      score -= 0.15;
    }
  }

  // Deliberately tiny: popularity is a tiebreaker, not a relevance signal.
  score += (result.qualitySignal ?? 0) * 0.04;

  return score;
}

function computeMetadataCompletenessScore(result: ArtworkResult): number {
  let score = 0;

  if (result.title.trim()) score += 0.08;
  if (result.artist.trim()) score += 0.08;
  if (result.source.trim()) score += 0.05;
  if (result.imageUrl.trim()) score += 0.14;
  if (result.originalLink.trim()) score += 0.12;
  if (result.thumbnailUrl?.trim()) score += 0.06;
  if (result.licenseType?.trim()) score += 0.04;
  if (result.sourceLink?.trim()) score += 0.03;

  return score;
}

function computeImageQualityScore(result: ArtworkResult): number {
  let score = 0;

  if (result.imageUrl.startsWith("https://")) {
    score += 0.08;
  }

  if (result.thumbnailUrl && result.thumbnailUrl !== result.imageUrl) {
    score += 0.03;
  }

  if (/images\.unsplash\.com|images\.metmuseum\.org|artic\.edu/.test(result.imageUrl)) {
    score += 0.03;
  }

  return score;
}

function computeVagueFieldPenalty(result: ArtworkResult): number {
  let penalty = 0;

  if (VAGUE_TITLE_PATTERN.test(result.title.trim())) {
    penalty += 0.09;
  }

  if (VAGUE_ARTIST_PATTERN.test(result.artist.trim())) {
    penalty += 0.06;
  }

  if (!result.thumbnailUrl) {
    penalty += 0.02;
  }

  return penalty;
}

function isValidArtworkResult(result: ArtworkResult): boolean {
  return Boolean(
    result.id &&
      result.title &&
      result.source &&
      result.imageUrl &&
      result.originalLink
  );
}

export function rankAndSelectResults(
  results: ArtworkResult[],
  plan: QueryPlan,
  limit: number
): ArtworkResult[] {
  const keywords = plan.rankWords;

  return results
    .filter(isValidArtworkResult)
    .map((result) => {
      const words = new Set(tokenize(resultText(result)));
      const titleMatches = sumWordMatches(
        new Set(tokenize(withoutEffectPhrases(result.title))),
        keywords
      );
      const artistMatches = sumWordMatches(new Set(tokenize(result.artist)), keywords);
      // Descriptive-metadata fields (tags/subjectTitles/styleTitles/themeTitles/medium)
      // are much richer on museum results. Taking their best single match instead of
      // summing all of them keeps a well-tagged museum piece from outscoring a good
      // title match just for having more metadata fields to match against.
      const secondaryMatches = Math.max(
        sumListMatches(result.tags, keywords),
        sumListMatches(result.subjectTitles, keywords),
        sumListMatches(result.styleTitles, keywords),
        sumListMatches(result.themeTitles, keywords),
        sumListMatches(result.medium ? [result.medium] : undefined, keywords)
      );
      const keywordScore =
        titleMatches * 0.22 + artistMatches * 0.12 + secondaryMatches * 0.12;
      const phraseBonus = computePhraseBonus(resultText(result), keywords);
      const intentScore = computeIntentScore(result, plan, words);
      const metadataScore = computeMetadataCompletenessScore(result);
      const imageScore = computeImageQualityScore(result);
      const vaguePenalty = computeVagueFieldPenalty(result);
      const existingScore = result.score ?? 0;

      const score =
        existingScore +
        keywordScore +
        phraseBonus +
        intentScore +
        metadataScore +
        imageScore -
        vaguePenalty;

      return {
        ...result,
        score: Number(score.toFixed(4))
      };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);
}
