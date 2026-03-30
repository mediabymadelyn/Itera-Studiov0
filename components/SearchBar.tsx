"use client";

import { FormEvent, useState } from "react";
import { ArtworkResult } from "@/lib/types/artwork";
import ResultCard from "@/components/ResultCard";

type SearchResponse = {
  results?: ArtworkResult[];
  error?: string;
};

export default function SearchBar() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ArtworkResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

      {error && <p className="state-text">{error}</p>}
      {!error && !loading && results.length === 0 && (
        <p className="state-text">Search to view credited Met results.</p>
      )}
      {loading && <p className="state-text">Loading results...</p>}

      <div className="results-grid">
        {results.map((result) => (
          <ResultCard key={result.id} result={result} />
        ))}
      </div>
    </section>
  );
}
