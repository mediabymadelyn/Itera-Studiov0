"use client";

import { SyntheticEvent, useEffect, useState } from "react";
import { ArtworkResult } from "@/lib/types/artwork";
import { reportUnsplashDownload } from "@/components/unsplashDownload";
import { lightingSubtagsOf } from "@/lib/search/categories";

// Lighting tags shown over the image on hover; the full set is in the
// expanded view.
const MAX_HOVER_TAGS = 2;

type ResultCardProps = {
  result: ArtworkResult;
  // The selected category or sub-tag, if any. Labels stay off the grid (a
  // stack of 2-3 badges per card read as clutter); only the selected one is
  // shown, on the cards it applies to (showsActiveTag).
  activeTag?: string;
  showsActiveTag?: boolean;
  onExpand: (result: ArtworkResult) => void;
  onUnavailable: (resultId: string) => void;
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

function isPhotoResult(result: ArtworkResult): boolean {
  return result.source.toLowerCase().includes("unsplash");
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
  activeTag,
  showsActiveTag,
  onExpand,
  onUnavailable
}: ResultCardProps) {
  const [imgSrc, setImgSrc] = useState(result.imageUrl);
  const [hasError, setHasError] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(result.imageAspectRatio);

  const isPhoto = isPhotoResult(result);

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

  const hoverTags = lightingSubtagsOf(result).slice(0, MAX_HOVER_TAGS);
  const palette = result.imageMetrics?.palette ?? [];

  return (
    <article className={isPhoto ? "result-card" : "result-card is-museum"}>
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
        {showsActiveTag && activeTag && <span className="card-tag">{activeTag}</span>}
        <span className="result-image-expand-hint">Click to expand</span>
        {/* What the image check saw, on hover: the kind of light and the
            main colors. Image search engines don't say why a result is
            there; Itera can. */}
        {(hoverTags.length > 0 || palette.length > 0) && (
          <span className="card-why" aria-hidden="true">
            {hoverTags.length > 0 && (
              <span className="card-why-tags">
                {hoverTags.map((tag) => (
                  <span key={tag} className="card-why-tag">
                    {tag}
                  </span>
                ))}
              </span>
            )}
            {palette.length > 0 && (
              <span className="card-palette">
                {palette.map((swatch) => (
                  <span key={swatch.color} style={{ background: swatch.color, flexGrow: swatch.share }} />
                ))}
              </span>
            )}
          </span>
        )}
      </button>
      {/* Every card shows title, creator, source, license and the original
          link. Creator and source link out wherever the source provides a
          page for them -- required for Unsplash, in its "Photo by X on
          Unsplash" form (photographer profile + Unsplash, with referral
          parameters; see unsplash.ts). Museum works read like a gallery
          wall label: italic title, artist and date, then the collection. */}
      {isPhoto ? (
        <div className="result-content">
          <span className="result-title-value" title={result.title}>
            {result.title}
          </span>
          <span className="result-credit">
            Photo by <AttributionLink href={result.artistLink}>{result.artist}</AttributionLink>{" "}
            on <AttributionLink href={result.sourceLink}>{result.source}</AttributionLink>
          </span>
          <span className="result-footer">
            {result.licenseType && <span className="result-license">{result.licenseType}</span>}
            <ViewOriginal result={result} />
          </span>
        </div>
      ) : (
        <div className="result-content wall-label">
          <span className="wall-title" title={result.title}>
            {result.title}
          </span>
          <span className="wall-artist">
            <AttributionLink href={result.artistLink}>{result.artist}</AttributionLink>
            {result.objectDate ? `, ${result.objectDate}` : ""}
          </span>
          <span className="result-footer">
            <span className="wall-collection">
              <AttributionLink href={result.sourceLink}>{result.source}</AttributionLink>
              {result.licenseType ? ` · ${result.licenseType}` : ""}
            </span>
            <ViewOriginal result={result} />
          </span>
        </div>
      )}
    </article>
  );
}

function ViewOriginal({ result }: { result: ArtworkResult }) {
  return (
    <a
      className="result-link"
      href={result.originalLink}
      target="_blank"
      rel="noreferrer"
      onClick={() => reportUnsplashDownload(result)}
    >
      View original
    </a>
  );
}
