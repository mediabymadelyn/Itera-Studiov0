import library from "@/lib/data/museum-library.json";
import { ArtworkResult } from "@/lib/types/artwork";
import { QueryPlan } from "@/lib/search/queryPlan";
import { hasAnyWord, isPeopleQuery, pickByQuery, subjectSynonyms, tokenize } from "@/lib/search/queryTerms";

// Museum catalogs almost never describe light, and live Met searches for it
// were slow and got rate-blocked mid-search (La Tour's Magdalen kept
// vanishing). So dramatic-lighting searches draw museum works from a
// library built offline (scripts/build-museum-library.mts): public-domain
// Met and AIC works known for strong or artificial light, each judged three
// times by the vision judge with the median kept. Search costs no museum
// requests, and the lighting scores don't wobble between searches.

type LibraryWork = ArtworkResult & {
  via: string;
  genres: string[];
  depicts: string[];
  people: boolean;
  artificialLight: boolean;
  lightingScore: number;
  lightingType: string;
  categories: string[];
  creditLine?: string;
  scores?: unknown;
};

const works = library.works as unknown as LibraryWork[];

const DRAMATIC_SCORE = 4;
const RESULTS_PER_SEARCH = 6;
// Rembrandt alone is a large share of the library; without a cap one
// search could be six Rembrandts.
const MAX_PER_ARTIST = 2;
// At least this many picks use colored or artificial light when any fit
// (lamplight, footlights, a green face lit from below): the fine-art
// counterpart to neon photos. See artificialLight in the build script.
const MIN_ARTIFICIAL_LIGHT = 1;

function matchesSubject(work: LibraryWork, plan: QueryPlan): boolean {
  const head = plan.subjectWords[plan.subjectWords.length - 1];
  if (!head) return true;

  const words = new Set(tokenize([work.title, ...work.genres, ...work.depicts].join(" ")));
  if (hasAnyWord(words, [head, ...subjectSynonyms(head)])) return true;

  return isPeopleQuery(plan.subjectWords) && work.people;
}

function toResult(work: LibraryWork, index: number): ArtworkResult {
  // Library-only fields stay out of the result sent to the page.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { via, genres, depicts, people, artificialLight, categories, creditLine, scores, ...artwork } = work;
  return {
    ...artwork,
    score: Math.max(0, 1 - index * 0.01),
    tags: [...genres, ...depicts],
    lightingFromLibrary: true,
    knownForDramaticLight: true,
    retrievedVia: "lighting"
  };
}

/**
 * Up to RESULTS_PER_SEARCH dramatic library works that fit the search's
 * subject, for "dramatic lighting" searches only. The starting point
 * rotates by query, so different searches surface different works.
 */
export function libraryResultsFor(plan: QueryPlan): ArtworkResult[] {
  if (plan.lighting?.kind !== "dramatic") return [];

  const matching = works.filter((work) => work.lightingScore >= DRAMATIC_SCORE && matchesSubject(work, plan));
  if (matching.length === 0) return [];

  const start = matching.indexOf(pickByQuery(plan.original, matching));
  const rotated = [...matching.slice(start), ...matching.slice(0, start)];
  const chosen: LibraryWork[] = [];
  const perArtist = new Map<string, number>();
  const take = (work: LibraryWork) => {
    if (chosen.length >= RESULTS_PER_SEARCH || chosen.includes(work)) return;
    const count = perArtist.get(work.artist) ?? 0;
    if (count >= MAX_PER_ARTIST) return;
    perArtist.set(work.artist, count + 1);
    chosen.push(work);
  };

  const isArtificial = (work: LibraryWork) => work.artificialLight;
  for (const work of rotated) {
    if (chosen.filter(isArtificial).length >= MIN_ARTIFICIAL_LIGHT) break;
    if (isArtificial(work)) take(work);
  }
  for (const work of rotated) take(work);

  return chosen.map(toResult);
}
