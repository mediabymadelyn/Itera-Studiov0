"use client";

import { ReactNode, useEffect, useRef } from "react";

// Grid rows are this tall; each card spans as many as its height needs.
const ROW_UNIT_PX = 4;

/**
 * Pinterest-style grid: equal-width columns, cards at their own height.
 * Built on CSS grid with each card spanning rows to fit (rather than CSS
 * columns, which fill each column top to bottom): grid places cards in
 * order, each in the first column with room, so the ranking still reads
 * left to right and the top result stays first.
 */
export default function MasonryGrid({
  children,
  busy
}: {
  children: ReactNode;
  busy?: boolean;
}) {
  const gridRef = useRef<HTMLDivElement>(null);

  // Runs after every render: cards come and go with searches and filters,
  // and re-observing a page of results is cheap.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
    const fit = (item: HTMLElement) => {
      const span = Math.ceil((item.getBoundingClientRect().height + gap) / ROW_UNIT_PX);
      item.style.gridRowEnd = `span ${span}`;
    };

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) fit(entry.target as HTMLElement);
    });
    for (const item of Array.from(grid.children)) observer.observe(item);

    return () => observer.disconnect();
  });

  return (
    <div ref={gridRef} className="results-grid" aria-busy={busy}>
      {children}
    </div>
  );
}
