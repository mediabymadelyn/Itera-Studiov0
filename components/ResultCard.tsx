"use client";

import { useEffect, useState } from "react";
import { ArtworkResult } from "@/lib/types/artwork";

type ResultCardProps = {
  result: ArtworkResult;
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

export default function ResultCard({ result, onExpand, onUnavailable }: ResultCardProps) {
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
        <img
          className="result-image"
          src={imgSrc}
          alt={result.title}
          loading="lazy"
          onError={handleImageError}
        />
        {result.isTopPick && (
          <span className="result-top-pick">Top Pick</span>
        )}
        {result.matchReason && (
          <span className="result-match-reason">{result.matchReason}</span>
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
        <div className="result-meta">
          <span className="result-meta-label">{creatorLabel}</span>
          <span>{result.artist}</span>
        </div>
        <div className="result-meta">
          <span className="result-meta-label">Source</span>
          <span>{result.source}</span>
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
