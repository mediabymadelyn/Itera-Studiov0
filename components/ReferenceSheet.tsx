"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArtworkResult } from "@/lib/types/artwork";
import { useSaved } from "@/lib/saved/savedStore";
import { boardColors } from "@/components/boardColors";
import { formatHex } from "@/components/CopyableSwatch";

// How many references to a printed page. Two is the default: big enough to
// work from, with the credit and note beside each image.
const LAYOUTS = [
  { value: "two", label: "2 per page" },
  { value: "one", label: "1 per page" },
  { value: "contact", label: "Contact sheet" }
] as const;
type Layout = (typeof LAYOUTS)[number]["value"];

function isPhoto(result: ArtworkResult): boolean {
  return result.source.toLowerCase().includes("unsplash");
}

/** The original's address without Unsplash's referral parameters. */
function printedLink(link: string): string {
  try {
    const url = new URL(link);
    url.search = "";
    return `${url.hostname.replace(/^www\./, "")}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return link;
  }
}

/**
 * One collection as a sheet of paper: its colors with their hex codes, then
 * every image with its full credit, its note, and where to find the
 * original -- so a printout or PDF stays credited away from the screen.
 */
export default function ReferenceSheet() {
  const saved = useSaved();
  const params = useSearchParams();
  const [ready, setReady] = useState(false);
  const [layout, setLayout] = useState<Layout>("two");
  useEffect(() => setReady(true), []);

  const boardId = params.get("board");
  const board = saved.boards.find((entry) => entry.id === boardId);
  const items = saved.items.filter((item) => !board || item.boardIds.includes(board.id));
  const colors = boardColors(items.map((item) => item.result));
  const title = board?.name ?? "All saved";

  if (!ready) return null;

  return (
    <div className="sheet">
      <div className="sheet-toolbar">
        <Link href="/saved" className="text-button">
          ← Back to Saved
        </Link>
        <div className="sheet-layouts" role="group" aria-label="Layout">
          {LAYOUTS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={layout === option.value ? "sheet-layout is-active" : "sheet-layout"}
              onClick={() => setLayout(option.value)}
              aria-pressed={layout === option.value}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button type="button" className="chip chip-small is-on" onClick={() => window.print()}>
          Save as PDF or print
        </button>
        <span className="sheet-hint">In the print window, choose “Save as PDF” as the destination.</span>
      </div>

      <header className="sheet-header">
        <span className="sheet-brand">Itera Studio</span>
        <h1 className="sheet-title">{title}</h1>
        <p className="sheet-meta">
          {items.length} {items.length === 1 ? "reference" : "references"} ·{" "}
          {new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
        </p>
      </header>

      {colors.length > 0 && (
        <div className="sheet-colors">
          {colors.map((swatch) => (
            <div key={swatch.color} className="sheet-color">
              <span className="sheet-color-chip" style={{ background: swatch.color }} />
              <span>{formatHex(swatch.color)}</span>
            </div>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <p className="sheet-empty">Nothing in this collection yet.</p>
      ) : (
        <div className={`sheet-grid is-${layout}`}>
          {items.map(({ result, note }) => (
            <figure key={result.id} className="sheet-item">
              <div className="sheet-image">
                <img src={result.imageUrl} alt={result.title} />
              </div>
              <figcaption>
                <span className="sheet-item-title">{result.title}</span>
                <span>
                  {isPhoto(result)
                    ? `Photo by ${result.artist} on Unsplash`
                    : `${result.artist}${result.objectDate ? `, ${result.objectDate}` : ""}`}
                </span>
                {!isPhoto(result) && <span>{result.source}</span>}
                {result.licenseType && <span>{result.licenseType}</span>}
                <span className="sheet-link">{printedLink(result.originalLink)}</span>
                {note && <span className="sheet-note">{note}</span>}
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      <footer className="sheet-footer">
        Real references, credited to the people who made them. Found with Itera Studio.
      </footer>
    </div>
  );
}
