import { searchAicArtworks } from "@/lib/sources/aic";
import { dedupeRankedResults } from "@/lib/search/dedupeResults";
import { searchMetArtworks } from "@/lib/sources/met";
import { rankAndSelectResults } from "@/lib/search/rankResults";
import { searchUnsplashArtworks } from "@/lib/sources/unsplash";
import { routeQueryToSources, SourceName } from "@/lib/search/routeQuery";
import { ArtworkResult } from "@/lib/types/artwork";

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

  const ranked = rankAndSelectResults(
    combined,
    query,
    routedSources,
    Math.max(combined.length, limit)
  );

  return dedupeRankedResults(ranked).slice(0, limit);
}
