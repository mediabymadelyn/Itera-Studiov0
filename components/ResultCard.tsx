"use client";

import { useEffect, useState } from "react";
import { ArtworkResult } from "@/lib/types/artwork";

type ResultCardProps = {
  result: ArtworkResult;
  // The category filter currently selected, if any. Labels stay off the
  // main grid (a stack of 2-3 badges per card read as clutter) and only the
  // selected category is shown, on the cards it applies to.
  activeReason?: string;
  onExpand: (result: ArtworkResult) => void;
  onUnavailable: (resultId: string) => void;
};

function getTypeLabel(source: string): "Museum" | "Photography" {
  return source.toLowerCase().includes("unsplash")
    ? "Photography"
    : "Museum";
}

function getCreatorLabel(source: string): "Artist" | "Photographer" {
  return source.toLowerCase().includes("unsplash")
    ? "Photographer"
    : "Artist";
}

export function AttributionLink({ href, children }: { href?: string; children: string }) {
  if (!href) return <span>{children}</span>;

  return (
    <a className="attribution-link" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

export default function ResultCard({
  result,
  activeReason,
  onExpand,
  onUnavailable
}: ResultCardProps) {
  const [imgSrc, setImgSrc] = useState(result.imageUrl);
  const [hasError, setHasError] = useState(false);

  const typeLabel = getTypeLabel(result.source);
  const creatorLabel = getCreatorLabel(result.source);

  useEffect(() => {
    if (hasError) {
      onUnavailable(result.id);
    }
  }, [hasError, result.id, onUnavailable]);

  function handleImageError() {
    if (result.thumbnailUrl && imgSrc !== result.thumbnailUrl) {
      setImgSrc(result.thumbnailUrl);
      return;
    }

    setHasError(true);
  }

  if (hasError) {
    return null;
  }

  return (
    <article className="result-card">
      <button
        type="button"
        className="result-image-button"
        onClick={() => onExpand(result)}
        aria-label={`Expand image: ${result.title}`}
      >
        {/* Fixed-shape frame keeps the grid tidy; the image itself is shown
            whole (never cropped, P2/P3) over a blurred copy of itself. */}
        <span
          className="result-image-frame"
          style={{ backgroundImage: `url(${JSON.stringify(imgSrc)})` }}
        >
          <img
            className="result-image"
            src={imgSrc}
            alt={result.title}
            loading="lazy"
            onError={handleImageError}
          />
        </span>
        {result.isTopPick && (
          <span className="result-top-pick">Top Pick</span>
        )}
        {activeReason && result.matchReasons?.includes(activeReason) && (
          <span className="result-match-reason">{activeReason}</span>
        )}
        <span className="result-image-expand-hint">Click to expand</span>
      </button>
      <div className="result-content">
        <div className="result-badges">
          <span className="result-badge">{typeLabel}</span>
        </div>
        <div className="result-meta">
          <span className="result-meta-label">Title</span>
          <span className="result-title-value">{result.title}</span>
        </div>
        {/* Creator and source link out wherever the source provides a page
            for them -- required for Unsplash (photographer profile +
            Unsplash, with referral parameters; see unsplash.ts). */}
        <div className="result-meta">
          <span className="result-meta-label">{creatorLabel}</span>
          <AttributionLink href={result.artistLink}>{result.artist}</AttributionLink>
        </div>
        <div className="result-meta">
          <span className="result-meta-label">Source</span>
          <AttributionLink href={result.sourceLink}>{result.source}</AttributionLink>
        </div>
        {result.licenseType && (
          <div className="result-meta">
            <span className="result-meta-label">License</span>
            <span>{result.licenseType}</span>
          </div>
        )}
        <a
          className="result-link"
          href={result.originalLink}
          target="_blank"
          rel="noreferrer"
        >
          View original
        </a>
      </div>
    </article>
  );
}
