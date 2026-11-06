"use client";

import { FormEvent, useCallback, useState } from "react";
import { ArtworkResult } from "@/lib/types/artwork";
import { MATCH_REASON_CATEGORIES } from "@/lib/search/categories";
import ResultCard from "@/components/ResultCard";
import Lightbox from "@/components/Lightbox";
import LoadingIndicator from "@/components/LoadingIndicator";
import MasonryGrid from "@/components/MasonryGrid";

type SearchResponse = {
  results?: ArtworkResult[];
  error?: string;
};

type ResultTypeFilter = "all" | "museum" | "photography";

// Long searches (LLM rewrite + several sources + relevance filtering) can
// take a while, but a request that hangs forever looked like the app was
// broken (P2). Past this, stop and say so instead of spinning.
const SEARCH_TIMEOUT_MS = 45000;
const LIGHTING_REASON = "Lighting";

const SKELETON_CARD_COUNT = 12;
// Mixed shapes, so the loading grid looks like the masonry grid it becomes.
const SKELETON_ASPECT_RATIOS = ["3 / 4", "4 / 3", "1", "2 / 3", "3 / 2", "4 / 5"];

function getResultType(result: ArtworkResult): ResultTypeFilter {
  return result.source.toLowerCase().includes("unsplash")
    ? "photography"
    : "museum";
}

export default function SearchBar() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ArtworkResult[]>([]);
  const [typeFilter, setTypeFilter] = useState<ResultTypeFilter>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedResult, setExpandedResult] = useState<ArtworkResult | null>(null);
  const [unavailableIds, setUnavailableIds] = useState<Set<string>>(new Set());
  // "all" means no match-reason filter applied. Every category is always
  // listed in a fixed order (testers wanted filters that don't move or
  // vanish between searches); counts come from matchReasons already on this
  // search's results (set by the LLM rerank layer's categorization step) --
  // no extra API call, no extra latency. On the plain keyword path there
  // are no labels, so every count is 0.
  const [reasonFilter, setReasonFilter] = useState("all");

  const handleUnavailable = useCallback((resultId: string) => {
    setUnavailableIds((prev) => (prev.has(resultId) ? prev : new Set(prev).add(resultId)));
  }, []);

  const loadedResults = results.filter((result) => !unavailableIds.has(result.id));
  // Bench results (see benchEmptyCategories in llmQueryLayer.ts) exist only
  // so every category has something to show; they never appear on the main
  // grid, only under their own category's filter, after the regular matches.
  const availableResults = loadedResults.filter((result) => !result.benchOnly);
  const typeMatches = (result: ArtworkResult) =>
    typeFilter === "all" || getResultType(result) === typeFilter;
  const typeMatchedResults = availableResults.filter(typeMatches);
  const typeMatchedBench = loadedResults.filter(
    (result) => result.benchOnly && typeMatches(result)
  );
  const reasonCounts = new Map<string, number>(
    MATCH_REASON_CATEGORIES.map((category) => [
      category,
      [...typeMatchedResults, ...typeMatchedBench].filter((result) =>
        (result.matchReasons ?? []).includes(category)
      ).length
    ])
  );
  const hasAnyLabels = Array.from(reasonCounts.values()).some((count) => count > 0);
  const hasReason = (result: ArtworkResult) =>
    (result.matchReasons ?? []).includes(reasonFilter);
  // Within the Lighting filter, strongest lighting comes first: the vision
  // check's 0-5 score (llmQueryLayer.ts) and the pixel drama measure
  // (imageAnalysis.ts), each weighted equally; unmeasured ones sort last.
  const lightingStrength = (result: ArtworkResult) =>
    ((result.lightingScore ?? 0) / 5 + (result.imageMetrics?.drama ?? 0)) / 2;
  const byLighting = (results: ArtworkResult[]) =>
    reasonFilter === LIGHTING_REASON
      ? [...results].sort((a, b) => lightingStrength(b) - lightingStrength(a))
      : results;
  const filteredResults =
    reasonFilter === "all"
      ? typeMatchedResults
      : [
          ...byLighting(typeMatchedResults.filter(hasReason)),
          ...byLighting(typeMatchedBench.filter(hasReason))
        ];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      setError("Please enter a search query.");
      setResults([]);
      return;
    }

    setLoading(true);
    setError(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(trimmedQuery)}`,
        { signal: controller.signal }
      );
      const data = (await response.json()) as SearchResponse;

      if (!response.ok) {
        throw new Error(data.error || "Search failed.");
      }

      setResults(data.results ?? []);
      setTypeFilter("all");
      setReasonFilter("all");
      setUnavailableIds(new Set());
    } catch (err) {
      const message =
        err instanceof Error && err.name === "AbortError"
          ? "This search took too long. Try again, or describe it in fewer words."
          : err instanceof Error
            ? err.message
            : "Search failed.";
      setError(message);
      setResults([]);
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }

  return (
    <section>
      <form className="search-form" onSubmit={handleSubmit}>
        <div className="search-input-wrap">
          <svg
            className="search-input-icon"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <line
              x1="21"
              y1="21"
              x2="16.65"
              y2="16.65"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <input
            className="search-input"
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="eg; dynamic anime pose mid jump dramatic lighting"
            aria-label="Search art references"
          />
        </div>
      </form>

      {!loading && results.length > 0 && (
        <div className="reason-filter-row">
          <span className="reason-filter-label">Filter by:</span>
          {MATCH_REASON_CATEGORIES.map((reason) => {
            const count = reasonCounts.get(reason) ?? 0;
            const active = reasonFilter === reason;

            return (
              <button
                key={reason}
                type="button"
                className={active ? "reason-pill reason-pill-active" : "reason-pill"}
                onClick={() => setReasonFilter((current) => (current === reason ? "all" : reason))}
                aria-pressed={active}
                disabled={count === 0 && !active}
              >
                {reason}
                <span className="reason-pill-count">{count}</span>
              </button>
            );
          })}
          {!hasAnyLabels && (
            <span className="reason-filter-empty">No categories for this search</span>
          )}
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="filters-row">
          {/* One control instead of separate Source + Type dropdowns: the two
              could be set to contradict each other (Unsplash + Museum), which
              read as the filter being broken (P2, P5). */}
          <label className="filter-control">
            <span className="filter-label">Show</span>
            <select
              className="filter-select"
              value={typeFilter}
              onChange={(event) =>
                setTypeFilter(event.target.value as ResultTypeFilter)
              }
            >
              <option value="all">All results</option>
              <option value="museum">Museum art</option>
              <option value="photography">Photography (Unsplash)</option>
            </select>
          </label>

          <button
            className="filter-reset"
            type="button"
            onClick={() => {
              setTypeFilter("all");
              setReasonFilter("all");
            }}
            disabled={typeFilter === "all" && reasonFilter === "all"}
          >
            Reset
          </button>

          <span className="filters-count">
            Showing {filteredResults.length} of {availableResults.length}
          </span>
        </div>
      )}

      {error && <p className="state-text">{error}</p>}
      {!error && !loading && results.length > 0 && availableResults.length === 0 && (
        <p className="state-text">No images could be loaded for this search.</p>
      )}
      {!error &&
        !loading &&
        availableResults.length > 0 &&
        filteredResults.length === 0 && (
          <p className="state-text">No results match the selected filters.</p>
        )}
      {loading && <LoadingIndicator />}

      <MasonryGrid busy={loading}>
        {loading
          ? Array.from({ length: SKELETON_CARD_COUNT }, (_, index) => (
              <div key={index} className="result-card result-card-skeleton" aria-hidden="true">
                <div
                  className="skeleton-image"
                  style={{ aspectRatio: SKELETON_ASPECT_RATIOS[index % SKELETON_ASPECT_RATIOS.length] }}
                />
                <div className="skeleton-line" />
                <div className="skeleton-line skeleton-line-short" />
              </div>
            ))
          : filteredResults.map((result, index) => (
              <ResultCard
                key={result.id}
                result={result}
                activeReason={reasonFilter === "all" ? undefined : reasonFilter}
                onExpand={setExpandedResult}
                onUnavailable={handleUnavailable}
                featured={index === 0 && result.isTopPick}
              />
            ))}
      </MasonryGrid>

      <Lightbox result={expandedResult} onClose={() => setExpandedResult(null)} />
    </section>
  );
}
