"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ArtworkResult } from "@/lib/types/artwork";
import ResultCard from "@/components/ResultCard";
import Lightbox from "@/components/Lightbox";
import LoadingIndicator from "@/components/LoadingIndicator";
import MasonryGrid from "@/components/MasonryGrid";
import FeaturedPalette from "@/components/FeaturedPalette";
import { FilterToolbar, useResultFilters } from "@/components/ResultFilters";

type SearchResponse = {
  results?: ArtworkResult[];
  error?: string;
};

// Shown under the search bar before the first search: common things
// artists come looking for, one click away.
const EXAMPLE_SEARCHES = ["hand gestures", "draped fabric", "dynamic pose", "seated figure"];

// Long searches (LLM rewrite + several sources + relevance filtering) can
// take a while, but a request that hangs forever looked like the app was
// broken (P2). Past this, stop and say so instead of spinning.
const SEARCH_TIMEOUT_MS = 45000;

const SKELETON_CARD_COUNT = 12;
// Mixed shapes, so the loading grid looks like the masonry grid it becomes.
const SKELETON_ASPECT_RATIOS = ["3 / 4", "4 / 3", "1", "2 / 3", "3 / 2", "4 / 5"];

export default function SearchBar() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ArtworkResult[]>([]);
  const [loading, setLoading] = useState(false);
  // After the first search the hero folds away, so results start near the
  // top of the page.
  const [hasSearched, setHasSearched] = useState(false);
  // The search block only gets a background while it's actually stuck to
  // the top (scrolled past its own spot); otherwise it would sit on the
  // page as a dark band. A 1px marker just above it says when that is.
  const stickyMarkerRef = useRef<HTMLDivElement>(null);
  const [isStuck, setIsStuck] = useState(false);

  useEffect(() => {
    const marker = stickyMarkerRef.current;
    if (!hasSearched || !marker) return;
    const observer = new IntersectionObserver(([entry]) => setIsStuck(!entry.isIntersecting));
    observer.observe(marker);
    return () => observer.disconnect();
  }, [hasSearched]);
  const [error, setError] = useState<string | null>(null);
  const [expandedResult, setExpandedResult] = useState<ArtworkResult | null>(null);
  const [unavailableIds, setUnavailableIds] = useState<Set<string>>(new Set());

  const handleUnavailable = useCallback((resultId: string) => {
    setUnavailableIds((prev) => (prev.has(resultId) ? prev : new Set(prev).add(resultId)));
  }, []);

  // Every result is on the page (see arrangeSections in searchAll.ts);
  // filters only narrow it down.
  const availableResults = results.filter((result) => !unavailableIds.has(result.id));
  const filters = useResultFilters(availableResults);
  const { ordered, isFiltered } = filters;
  const bestMatches = ordered.filter((result) => result.section !== "more");
  const moreResults = ordered.filter((result) => result.section === "more");
  const toolbarShown = !loading && results.length > 0;

  // The expanded view steps through the page in its shown order (Best
  // matches, then More results), stopping at either end.
  const pageOrder = [...bestMatches, ...moreResults];
  const expandedIndex = expandedResult ? pageOrder.findIndex((result) => result.id === expandedResult.id) : -1;
  const stepTo = (offset: number) => {
    const next = pageOrder[expandedIndex + offset];
    return expandedIndex === -1 || !next ? undefined : () => setExpandedResult(next);
  };

  function renderCards(list: ArtworkResult[]) {
    return list.map((result) => (
      <ResultCard
        key={result.id}
        result={result}
        activeTag={filters.activeTag}
        showsActiveTag={filters.showsActiveTag(result)}
        onExpand={setExpandedResult}
        onUnavailable={handleUnavailable}
      />
    ));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch(query);
  }

  function searchExample(example: string) {
    setQuery(example);
    void runSearch(example);
  }

  async function runSearch(text: string) {
    const trimmedQuery = text.trim();

    if (!trimmedQuery) {
      setError("Please enter a search query.");
      setResults([]);
      return;
    }

    setLoading(true);
    setHasSearched(true);
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
      filters.reset();
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
      <div className={hasSearched ? "hero is-collapsed" : "hero"} aria-hidden={hasSearched}>
        <h1 className="hero-title brand-gradient-text">Itera Studio</h1>
        <p className="hero-subhead">Find real references from real artists.</p>
        <FeaturedPalette />
      </div>

      <div ref={stickyMarkerRef} className="sticky-marker" aria-hidden="true" />
      <div
        className={["search-sticky", hasSearched && "is-active", isStuck && "is-stuck"].filter(Boolean).join(" ")}
      >
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
            placeholder="Search for a pose, a subject or a kind of light"
            aria-label="Search art references"
          />
        </div>
      </form>

      {!hasSearched && (
        <div className="example-searches" aria-label="Example searches">
          <span className="example-label">Start with</span>
          {EXAMPLE_SEARCHES.map((example) => (
            <button key={example} type="button" className="chip chip-small" onClick={() => searchExample(example)}>
              {example}
            </button>
          ))}
        </div>
      )}

      {toolbarShown && <FilterToolbar filters={filters} />}

      </div>

      {error && <p className="state-text">{error}</p>}
      {!error && !loading && results.length > 0 && availableResults.length === 0 && (
        <p className="state-text">No images could be loaded for this search.</p>
      )}
      {!error && !loading && availableResults.length > 0 && ordered.length === 0 && (
        <p className="state-text">No results match the selected filters.</p>
      )}
      {loading && <LoadingIndicator />}

      {loading && (
        <MasonryGrid busy>
          {Array.from({ length: SKELETON_CARD_COUNT }, (_, index) => (
            <div key={index} className="result-card result-card-skeleton" aria-hidden="true">
              <div
                className="skeleton-image"
                style={{ aspectRatio: SKELETON_ASPECT_RATIOS[index % SKELETON_ASPECT_RATIOS.length] }}
              />
              {/* Same three lines as a real card: title, credit, footer. */}
              <div className="skeleton-lines">
                <div className="skeleton-line skeleton-title" />
                <div className="skeleton-line skeleton-credit" />
                <div className="skeleton-footer">
                  <div className="skeleton-line skeleton-tag" />
                  <div className="skeleton-line skeleton-link" />
                </div>
              </div>
            </div>
          ))}
        </MasonryGrid>
      )}

      {!loading && bestMatches.length > 0 && (
        <>
          <h2 className="section-heading">
            {moreResults.length > 0 ? "Best matches" : "Results"}{" "}
            <span className="section-count">{bestMatches.length}</span>
            {isFiltered && (
              <span className="section-filtered">
                {ordered.length} of {availableResults.length} shown
              </span>
            )}
          </h2>
          <MasonryGrid>{renderCards(bestMatches)}</MasonryGrid>
        </>
      )}

      {/* Nothing matched every part of the search: say so plainly at the
          top instead of opening the page on a "More results" divider. */}
      {!loading && bestMatches.length === 0 && moreResults.length > 0 && (
        <p className="state-text no-match-note">
          No exact matches for this search. Here are the closest.
        </p>
      )}

      {!loading && moreResults.length > 0 && (
        <>
          {bestMatches.length > 0 && (
          <div className="section-divider" role="separator">
            <span>
              More results <span className="section-count">{moreResults.length}</span>
              <span className="section-note">partial matches, or weaker on part of your search</span>
            </span>
          </div>
          )}
          <MasonryGrid>{renderCards(moreResults)}</MasonryGrid>
        </>
      )}

      <Lightbox
        result={expandedResult}
        onClose={() => setExpandedResult(null)}
        onPrevious={stepTo(-1)}
        onNext={stepTo(1)}
      />
    </section>
  );
}
