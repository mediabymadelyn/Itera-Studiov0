"use client";

import { SyntheticEvent, useEffect, useState } from "react";
import { ArtworkResult } from "@/lib/types/artwork";
import { reportUnsplashDownload } from "@/components/unsplashDownload";

type ResultCardProps = {
  result: ArtworkResult;
  // The category filter currently selected, if any. Labels stay off the
  // main grid (a stack of 2-3 badges per card read as clutter) and only the
  // selected category is shown, on the cards it applies to.
  activeReason?: string;
  onExpand: (result: ArtworkResult) => void;
  onUnavailable: (resultId: string) => void;
  // The top pick, when it leads the grid: shown two columns wide.
  featured?: boolean;
};

// Cards take their image's own shape (P2/P3 didn't want images cropped),
// within these limits so a panorama or a long scroll doesn't produce a
// sliver or a tower; past them the image is shown whole over a blurred
// copy of itself. Until an image's shape is known, its card is 3:4.
const MIN_ASPECT_RATIO = 0.5;
const MAX_ASPECT_RATIO = 2;
const DEFAULT_ASPECT_RATIO = 3 / 4;

function frameAspectRatio(ratio: number | undefined): number {
  return Math.min(MAX_ASPECT_RATIO, Math.max(MIN_ASPECT_RATIO, ratio ?? DEFAULT_ASPECT_RATIO));
}

function getTypeLabel(source: string): "Museum" | "Photography" {
  return source.toLowerCase().includes("unsplash")
    ? "Photography"
    : "Museum";
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
  onUnavailable,
  featured
}: ResultCardProps) {
  const [imgSrc, setImgSrc] = useState(result.imageUrl);
  const [hasError, setHasError] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(result.imageAspectRatio);

  const typeLabel = getTypeLabel(result.source);
  const isPhoto = typeLabel === "Photography";

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

  function handleImageLoad(event: SyntheticEvent<HTMLImageElement>) {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (naturalWidth && naturalHeight) setAspectRatio(naturalWidth / naturalHeight);
  }

  if (hasError) {
    return null;
  }

  return (
    <article className={`result-card${featured ? " result-card-featured" : ""}`}>
      <button
        type="button"
        className="result-image-button"
        onClick={() => onExpand(result)}
        aria-label={`Expand image: ${result.title}`}
      >
        <span
          className="result-image-frame"
          style={{
            backgroundImage: `url(${JSON.stringify(imgSrc)})`,
            aspectRatio: String(frameAspectRatio(aspectRatio))
          }}
        >
          <img
            className="result-image"
            src={imgSrc}
            alt={result.title}
            loading="lazy"
            onLoad={handleImageLoad}
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
      {/* Compact credit block: every card still shows title, creator,
          source, license and the original link. Creator and source link out
          wherever the source provides a page for them -- required for
          Unsplash, in its "Photo by X on Unsplash" form (photographer
          profile + Unsplash, with referral parameters; see unsplash.ts). */}
      <div className="result-content">
        <span className="result-badge">{typeLabel}</span>
        <span className="result-title-value" title={result.title}>
          {result.title}
        </span>
        <span className="result-credit">
          {isPhoto ? (
            <>
              Photo by <AttributionLink href={result.artistLink}>{result.artist}</AttributionLink>{" "}
              on <AttributionLink href={result.sourceLink}>{result.source}</AttributionLink>
            </>
          ) : (
            <>
              <AttributionLink href={result.artistLink}>{result.artist}</AttributionLink>
              {" · "}
              <AttributionLink href={result.sourceLink}>{result.source}</AttributionLink>
            </>
          )}
        </span>
        <span className="result-footer">
          {result.licenseType && <span className="result-license">{result.licenseType}</span>}
          <a
            className="result-link"
            href={result.originalLink}
            target="_blank"
            rel="noreferrer"
            onClick={() => reportUnsplashDownload(result)}
          >
            View original
          </a>
        </span>
      </div>
    </article>
  );
}
