import { ArtworkResult } from "@/lib/types/artwork";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "art",
  "for",
  "in",
  "of",
  "on",
  "the",
  "to",
  "with"
]);

const VAGUE_TITLE_PATTERN = /^(untitled|unknown|untitled photo|image)$/i;
const VAGUE_ARTIST_PATTERN = /^(unknown|unknown artist|unknown photographer)$/i;

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9-]/g, ""))
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function countKeywordMatches(text: string, keywords: string[]): number {
  const normalizedText = text.toLowerCase();

  return keywords.reduce((count, keyword) => {
    return normalizedText.includes(keyword) ? count + 1 : count;
  }, 0);
}

function countKeywordMatchesInList(values: string[] | undefined, keywords: string[]): number {
  if (!values || values.length === 0) {
    return 0;
  }

  return countKeywordMatches(values.join(" "), keywords);
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
  query: string,
  limit: number
): ArtworkResult[] {
  const keywords = tokenizeQuery(query);

  return results
    .filter(isValidArtworkResult)
    .map((result) => {
      const titleMatches = countKeywordMatches(result.title, keywords);
      const artistMatches = countKeywordMatches(result.artist, keywords);
      // Descriptive-metadata fields (tags/subjectTitles/styleTitles/themeTitles/medium)
      // only exist on museum-source results. Taking their best single match instead of
      // summing all of them keeps a well-tagged museum piece from outscoring a good
      // title match just for having more metadata fields to match against.
      const secondaryMatches = Math.max(
        countKeywordMatchesInList(result.tags, keywords),
        countKeywordMatchesInList(result.subjectTitles, keywords),
        countKeywordMatchesInList(result.styleTitles, keywords),
        countKeywordMatchesInList(result.themeTitles, keywords),
        countKeywordMatches(result.medium ?? "", keywords)
      );
      const keywordScore =
        titleMatches * 0.22 + artistMatches * 0.12 + secondaryMatches * 0.12;
      const metadataScore = computeMetadataCompletenessScore(result);
      const imageScore = computeImageQualityScore(result);
      const vaguePenalty = computeVagueFieldPenalty(result);
      const existingScore = result.score ?? 0;

      const score =
        existingScore +
        keywordScore +
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
