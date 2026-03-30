"use client";

import { FormEvent, useState } from "react";
import { ArtworkResult } from "@/lib/types/artwork";
import ResultCard from "@/components/ResultCard";

type SearchResponse = {
  results?: ArtworkResult[];
  error?: string;
};

type ResultTypeFilter = "all" | "museum" | "photography";

function getResultType(result: ArtworkResult): ResultTypeFilter {
  return result.source.toLowerCase().includes("unsplash")
    ? "photography"
    : "museum";
}

export default function SearchBar() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ArtworkResult[]>([]);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<ResultTypeFilter>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceOptions = Array.from(new Set(results.map((result) => result.source)));
  const filteredResults = results.filter((result) => {
    const sourceMatches = sourceFilter === "all" || result.source === sourceFilter;
    const typeMatches = typeFilter === "all" || getResultType(result) === typeFilter;

    return sourceMatches && typeMatches;
  });

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

    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(trimmedQuery)}`
      );
      const data = (await response.json()) as SearchResponse;

      if (!response.ok) {
        throw new Error(data.error || "Search failed.");
      }

      setResults(data.results ?? []);
      setSourceFilter("all");
      setTypeFilter("all");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Search failed.";
      setError(message);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <form className="search-form" onSubmit={handleSubmit}>
        <input
          className="search-input"
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Try: portrait oil painting"
          aria-label="Search art references"
        />
        <button className="search-button" type="submit" disabled={loading}>
          {loading ? "Searching..." : "Search"}
        </button>
      </form>

      {results.length > 0 && (
        <div className="filters-row">
          <label className="filter-control">
            <span className="filter-label">Source</span>
            <select
              className="filter-select"
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value)}
            >
              <option value="all">All Sources</option>
              {sourceOptions.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
          </label>

          <label className="filter-control">
            <span className="filter-label">Type</span>
            <select
              className="filter-select"
              value={typeFilter}
              onChange={(event) =>
                setTypeFilter(event.target.value as ResultTypeFilter)
              }
            >
              <option value="all">All Types</option>
              <option value="museum">Museum</option>
              <option value="photography">Photography</option>
            </select>
          </label>

          <button
            className="filter-reset"
            type="button"
            onClick={() => {
              setSourceFilter("all");
              setTypeFilter("all");
            }}
            disabled={sourceFilter === "all" && typeFilter === "all"}
          >
            Reset
          </button>

          <span className="filters-count">
            Showing {filteredResults.length} of {results.length}
          </span>
        </div>
      )}

      {error && <p className="state-text">{error}</p>}
      {!error && !loading && results.length === 0 && (
        <p className="state-text">Search to view credited Met results.</p>
      )}
      {!error && !loading && results.length > 0 && filteredResults.length === 0 && (
        <p className="state-text">No results match the selected filters.</p>
      )}
      {loading && <p className="state-text">Loading results...</p>}

      <div className="results-grid">
        {filteredResults.map((result) => (
          <ResultCard key={result.id} result={result} />
        ))}
      </div>
    </section>
  );
}
