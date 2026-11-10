"use client";

import { ReactNode, useState } from "react";
import { ArtworkResult } from "@/lib/types/artwork";
import {
  CATEGORY_LABELS,
  MATCH_REASON_CATEGORIES,
  MatchReasonCategory,
  SUBTAGS,
  subtagsOf
} from "@/lib/search/categories";
import { useSlidingHighlight } from "@/components/useSlidingHighlight";

// The filter toolbar shared by search results and saved boards: All / Art /
// Photo, the category chips with counts, and a selected category's
// sub-tags on the line below.

export type ResultTypeFilter = "all" | "museum" | "photography";

// One segmented control instead of separate Source + Type dropdowns: the
// two could be set to contradict each other (Unsplash + Museum), which read
// as the filter being broken (P2, P5).
const TYPE_OPTIONS: { value: ResultTypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "museum", label: "Art" },
  { value: "photography", label: "Photo" }
];

function getResultType(result: ArtworkResult): ResultTypeFilter {
  return result.source.toLowerCase().includes("unsplash") ? "photography" : "museum";
}

// Within the Lighting filter, strongest lighting comes first: the vision
// check's 0-5 score and the pixel drama measure (imageAnalysis.ts), each
// weighted equally; unmeasured ones sort last.
function lightingStrength(result: ArtworkResult): number {
  return ((result.lightingScore ?? 0) / 5 + (result.imageMetrics?.drama ?? 0)) / 2;
}

/** Filter state over a list of results, and the filtered list. */
export function useResultFilters(results: ArtworkResult[]) {
  const [typeFilter, setTypeFilter] = useState<ResultTypeFilter>("all");
  // null means no category filter. Every category is always listed in a
  // fixed order (testers wanted filters that don't move or vanish between
  // searches); counts come from labels already on the results.
  const [categoryFilter, setCategoryFilter] = useState<MatchReasonCategory | null>(null);
  // A sub-tag of the selected category ("Side / split" under Lighting).
  const [subtagFilter, setSubtagFilter] = useState<string | null>(null);

  const typeMatched = results.filter((result) => typeFilter === "all" || getResultType(result) === typeFilter);
  const categoryCounts = new Map(
    MATCH_REASON_CATEGORIES.map((category) => [
      category,
      typeMatched.filter((result) => (result.matchReasons ?? []).includes(category)).length
    ])
  );
  const subtags = categoryFilter ? SUBTAGS[categoryFilter] ?? [] : [];
  const subtagCount = (tag: string) =>
    typeMatched.filter((result) => categoryFilter && subtagsOf(result, categoryFilter).includes(tag)).length;

  // A sub-tag looks at the image itself, so it covers every result, not
  // only the ones labeled with its category.
  const matchesFilter = (result: ArtworkResult) => {
    if (!categoryFilter) return false;
    if (subtagFilter) return subtagsOf(result, categoryFilter).includes(subtagFilter);
    return (result.matchReasons ?? []).includes(categoryFilter);
  };
  const filtered = typeMatched.filter((result) => !categoryFilter || matchesFilter(result));
  const ordered =
    categoryFilter === "Lighting" ? [...filtered].sort((a, b) => lightingStrength(b) - lightingStrength(a)) : filtered;

  function selectCategory(category: MatchReasonCategory) {
    setCategoryFilter((current) => (current === category ? null : category));
    setSubtagFilter(null);
  }

  function reset() {
    setTypeFilter("all");
    setCategoryFilter(null);
    setSubtagFilter(null);
  }

  return {
    typeFilter,
    setTypeFilter,
    categoryFilter,
    selectCategory,
    subtagFilter,
    setSubtagFilter,
    categoryCounts,
    subtags,
    subtagCount,
    ordered,
    reset,
    isFiltered: typeFilter !== "all" || categoryFilter !== null,
    activeTag: subtagFilter ?? (categoryFilter ? CATEGORY_LABELS[categoryFilter] : undefined),
    // Whether a card shows the selected tag as a badge.
    showsActiveTag: matchesFilter
  };
}

export type ResultFilters = ReturnType<typeof useResultFilters>;

/** The toolbar and the sub-tag row for useResultFilters' state. */
export function FilterToolbar({ filters, end }: { filters: ResultFilters; end?: ReactNode }) {
  const { typeFilter, categoryFilter, subtagFilter, categoryCounts, subtags } = filters;
  const countsKey = Array.from(categoryCounts.values()).join(",");
  const typeHighlight = useSlidingHighlight(typeFilter);
  const categoryHighlight = useSlidingHighlight(categoryFilter, [countsKey]);
  const subtagHighlight = useSlidingHighlight(subtagFilter, [categoryFilter, typeFilter, countsKey]);

  return (
    <>
      <div className="toolbar" role="toolbar" aria-label="Filter results">
        <div
          className="segmented"
          role="group"
          aria-label="Show"
          ref={typeHighlight.groupRef}
          {...typeHighlight.groupHandlers}
        >
          <span
            className={typeHighlight.previewing ? "chip-highlight is-previewing" : "chip-highlight"}
            style={typeHighlight.highlightStyle}
            aria-hidden="true"
          />
          {TYPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              data-key={option.value}
              type="button"
              className={typeFilter === option.value ? "segmented-option is-active" : "segmented-option"}
              onClick={() => filters.setTypeFilter(option.value)}
              aria-pressed={typeFilter === option.value}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="chip-row" ref={categoryHighlight.groupRef} {...categoryHighlight.groupHandlers}>
          <span
            className={categoryHighlight.previewing ? "chip-highlight is-previewing" : "chip-highlight"}
            style={categoryHighlight.highlightStyle}
            aria-hidden="true"
          />
          {MATCH_REASON_CATEGORIES.map((category) => {
            const count = categoryCounts.get(category) ?? 0;
            const active = categoryFilter === category;
            return (
              <button
                key={category}
                data-key={category}
                type="button"
                className={["chip", active && "is-active", count === 0 && "is-empty"].filter(Boolean).join(" ")}
                onClick={() => filters.selectCategory(category)}
                aria-pressed={active}
                disabled={count === 0 && !active}
              >
                {CATEGORY_LABELS[category]}
                <span className="chip-count">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Clear only appears once there's a filter to clear, so the row
            fits on one line. */}
        {(filters.isFiltered || end) && (
          <div className="toolbar-end">
            {filters.isFiltered && (
              <button type="button" className="text-button" onClick={filters.reset}>
                Clear
              </button>
            )}
            {end}
          </div>
        )}
      </div>

      {subtags.length > 0 && categoryFilter && (
        <div
          className="subchip-row"
          role="group"
          aria-label={`${CATEGORY_LABELS[categoryFilter]} types`}
          ref={subtagHighlight.groupRef}
          {...subtagHighlight.groupHandlers}
        >
          <span
            className={subtagHighlight.previewing ? "chip-highlight is-previewing" : "chip-highlight"}
            style={subtagHighlight.highlightStyle}
            aria-hidden="true"
          />
          {subtags.map((tag) => {
            const count = filters.subtagCount(tag);
            const active = subtagFilter === tag;
            return (
              <button
                key={tag}
                data-key={tag}
                type="button"
                className={["chip", "chip-small", active && "is-active", count === 0 && "is-empty"]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => filters.setSubtagFilter((current) => (current === tag ? null : tag))}
                aria-pressed={active}
                disabled={count === 0 && !active}
              >
                {tag}
                <span className="chip-count">{count}</span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
