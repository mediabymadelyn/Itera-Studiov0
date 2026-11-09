"use client";

import { useEffect } from "react";
import { ArtworkResult } from "@/lib/types/artwork";
import { AttributionLink } from "@/components/ResultCard";
import { reportUnsplashDownload } from "@/components/unsplashDownload";
import {
  CATEGORY_LABELS,
  MatchReasonCategory,
  colorSubtagsOf,
  lightingSubtagsOf
} from "@/lib/search/categories";

// Lighting scores at or above this are dramatic (see isStronglyLit in
// lib/search/imageAnalysis.ts).
const DRAMATIC_LIGHTING_SCORE = 4;

type LightboxProps = {
  result: ArtworkResult | null;
  onClose: () => void;
};

const AIC_IIIF_WIDTH_PATTERN = /\/iiif\/2\/[^/]+\/full\/\d+,\/0\/default\.jpg$/;

function getExpandedImageUrl(result: ArtworkResult): string {
  if (AIC_IIIF_WIDTH_PATTERN.test(result.imageUrl)) {
    return result.imageUrl.replace(/\/full\/\d+,\//, "/full/1686,/");
  }

  return result.imageUrl;
}

export default function Lightbox({ result, onClose }: LightboxProps) {
  useEffect(() => {
    if (!result) {
      return;
    }

    // Opening a photo full-size is how a user picks it as a reference.
    reportUnsplashDownload(result);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [result, onClose]);

  if (!result) {
    return null;
  }

  // What the vision check saw: the kind of light (and whether it's
  // dramatic), measured color, then the reference categories.
  const lightingTags = lightingSubtagsOf(result);
  // The image's main colors, measured from its pixels, each as wide as
  // its share of the image.
  const palette = result.imageMetrics?.palette ?? [];
  const whyTags = [
    ...(lightingTags.length > 0 ? [`Lighting: ${lightingTags.join(" · ")}`] : []),
    ...((result.lightingScore ?? 0) >= DRAMATIC_LIGHTING_SCORE ? ["Dramatic light"] : []),
    ...colorSubtagsOf(result),
    ...(result.matchReasons ?? []).map(
      (reason) => CATEGORY_LABELS[reason as MatchReasonCategory] ?? reason
    )
  ];

  return (
    <div
      className="lightbox-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={result.title}
    >
      <div className="lightbox-content" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="lightbox-close"
          onClick={onClose}
          aria-label="Close expanded image"
        >
          ×
        </button>
        <img
          className="lightbox-image"
          src={getExpandedImageUrl(result)}
          alt={result.title}
        />
        <div className="lightbox-info">
          <div className="lightbox-title">{result.title}</div>
          <div className="lightbox-meta">
            {result.source === "Unsplash" ? (
              <>
                Photo by <AttributionLink href={result.artistLink}>{result.artist}</AttributionLink>{" "}
                on <AttributionLink href={result.sourceLink}>Unsplash</AttributionLink>
              </>
            ) : (
              <>
                {result.artist} ·{" "}
                <AttributionLink href={result.sourceLink}>{result.source}</AttributionLink>
              </>
            )}
          </div>
          {(whyTags.length > 0 || palette.length > 0) && (
            <div className="lightbox-why">
              <span className="lightbox-why-heading">Why this result</span>
              <div className="tag-row">
                {whyTags.map((tag) => (
                  <span key={tag} className="info-tag">
                    {tag}
                  </span>
                ))}
              </div>
              {palette.length > 0 && (
                <div className="swatches" aria-label="Main colors">
                  {palette.map((swatch) => (
                    <span
                      key={swatch.color}
                      className="swatch"
                      style={{ background: swatch.color, flexGrow: swatch.share }}
                      title={`${swatch.color} (${Math.round(swatch.share * 100)}%)`}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
          <a
            className="result-link"
            href={result.originalLink}
            target="_blank"
            rel="noreferrer"
            onClick={() => reportUnsplashDownload(result)}
          >
            View original
          </a>
        </div>
      </div>
    </div>
  );
}
