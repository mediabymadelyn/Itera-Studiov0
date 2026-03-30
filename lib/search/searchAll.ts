import { searchAicArtworks } from "@/lib/sources/aic";
import { searchMetArtworks } from "@/lib/sources/met";
import { searchUnsplashArtworks } from "@/lib/sources/unsplash";
import { ArtworkResult } from "@/lib/types/artwork";
import { routeQueryToSources, SourceName } from "@/lib/search/routeQuery";

function isValidArtworkResult(result: ArtworkResult): boolean {
  return Boolean(
    result.id &&
      result.title &&
      result.source &&
      result.imageUrl &&
      result.originalLink
  );
}

function mergeResults(results: ArtworkResult[], limit: number): ArtworkResult[] {
  return results
    .filter(isValidArtworkResult)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);
}

function applySourcePriority(
  results: ArtworkResult[],
  priority: SourceName[]
): ArtworkResult[] {
  return results.map((result) => {
    const index = priority.findIndex((source) => result.id.startsWith(`${source}-`));
    const bonus = index === -1 ? 0 : (priority.length - index) * 0.05;

    return {
      ...result,
      score: (result.score ?? 0) + bonus
    };
  });
}

export async function searchAllArtworks(
  query: string,
  limit = 6
): Promise<ArtworkResult[]> {
  const routedSources = routeQueryToSources(query);

  const searchTasks: Record<SourceName, Promise<ArtworkResult[]>> = {
    met: searchMetArtworks(query, limit),
    aic: searchAicArtworks(query, limit),
    unsplash: searchUnsplashArtworks(query, limit)
  };

  const settledResults = await Promise.allSettled(
    routedSources.map((source) => searchTasks[source])
  );

  const combined = settledResults.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []
  );

  return mergeResults(applySourcePriority(combined, routedSources), limit);
}
