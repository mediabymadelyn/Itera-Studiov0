import { ArtworkResult } from "@/lib/types/artwork";

const VAGUE_ARTIST_PATTERN = /^(unknown|unknown artist|unknown photographer)$/i;
const VAGUE_TITLE_PATTERN = /^(untitled|unknown|untitled photo|image)$/i;

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[\.,/#!$%\^&\*;:{}=\-_`~()'"?]/g, "")
    .replace(/\s+/g, " ");
}

function hasSparseIdentityData(result: ArtworkResult): boolean {
  const title = normalizeText(result.title);
  const artist = normalizeText(result.artist);

  if (title.length < 4 || artist.length < 4) {
    return true;
  }

  if (VAGUE_TITLE_PATTERN.test(title) || VAGUE_ARTIST_PATTERN.test(artist)) {
    return true;
  }

  return false;
}

function buildTitleArtistKey(result: ArtworkResult): string | null {
  if (hasSparseIdentityData(result)) {
    return null;
  }

  const title = normalizeText(result.title);
  const artist = normalizeText(result.artist);

  return `${title}::${artist}`;
}

function areTitleArtistPairsSimilar(a: ArtworkResult, b: ArtworkResult): boolean {
  const aKey = buildTitleArtistKey(a);
  const bKey = buildTitleArtistKey(b);

  if (!aKey || !bKey) {
    return false;
  }

  if (aKey === bKey) {
    return true;
  }

  const [aTitle, aArtist] = aKey.split("::");
  const [bTitle, bArtist] = bKey.split("::");

  const artistMatches = aArtist === bArtist;
  const titleContains = aTitle.includes(bTitle) || bTitle.includes(aTitle);

  return artistMatches && titleContains;
}

export function dedupeRankedResults(results: ArtworkResult[]): ArtworkResult[] {
  const kept: ArtworkResult[] = [];
  const linkToIndex = new Map<string, number>();

  for (const result of results) {
    const normalizedLink = normalizeText(result.originalLink);
    const resultScore = result.score ?? 0;

    if (normalizedLink) {
      const existingLinkIndex = linkToIndex.get(normalizedLink);

      if (existingLinkIndex !== undefined) {
        const existing = kept[existingLinkIndex];
        const existingScore = existing.score ?? 0;

        if (resultScore > existingScore) {
          kept[existingLinkIndex] = result;
        }

        continue;
      }
    }

    const similarIndex = kept.findIndex((existing) =>
      areTitleArtistPairsSimilar(existing, result)
    );

    if (similarIndex !== -1) {
      const existing = kept[similarIndex];
      const existingScore = existing.score ?? 0;

      if (resultScore > existingScore) {
        kept[similarIndex] = result;

        const existingLink = normalizeText(existing.originalLink);

        if (existingLink) {
          linkToIndex.delete(existingLink);
        }

        if (normalizedLink) {
          linkToIndex.set(normalizedLink, similarIndex);
        }
      }

      continue;
    }

    const nextIndex = kept.length;
    kept.push(result);

    if (normalizedLink) {
      linkToIndex.set(normalizedLink, nextIndex);
    }
  }

  kept.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  return kept;
}
