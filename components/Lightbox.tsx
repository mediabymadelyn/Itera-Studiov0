"use client";

import { MouseEvent, useEffect, useState } from "react";
import { ArtworkResult } from "@/lib/types/artwork";
import { AttributionLink } from "@/components/ResultCard";
import { reportUnsplashDownload } from "@/components/unsplashDownload";
import CopyableSwatch, { formatHex, useCopy } from "@/components/CopyableSwatch";
import {
  CATEGORY_LABELS,
  MatchReasonCategory,
  colorSubtagsOf,
  lightingSubtagsOf
} from "@/lib/search/categories";

// Lighting scores at or above this are dramatic (see isStronglyLit in
// lib/search/imageAnalysis.ts).
const DRAMATIC_LIGHTING_SCORE = 4;
// How long "Copied" shows after copying the credit.
const COPIED_NOTICE_MS = 1800;

type LightboxProps = {
  result: ArtworkResult | null;
  onClose: () => void;
  // Step to the neighbouring result on the page (← / → keys too).
  onPrevious?: () => void;
  onNext?: () => void;
};

const AIC_IIIF_WIDTH_PATTERN = /\/iiif\/2\/[^/]+\/full\/\d+,\/0\/default\.jpg$/;

function getExpandedImageUrl(result: ArtworkResult): string {
  if (AIC_IIIF_WIDTH_PATTERN.test(result.imageUrl)) {
    return result.imageUrl.replace(/\/full\/\d+,\//, "/full/1686,/");
  }

  return result.imageUrl;
}

function isPhotoResult(result: ArtworkResult): boolean {
  return result.source.toLowerCase().includes("unsplash");
}

/**
 * A ready-to-paste credit line: Unsplash's own "Photo by X on Unsplash"
 * form for photos, a museum-style citation for artworks.
 */
export function creditLine(result: ArtworkResult): string {
  if (isPhotoResult(result)) return `Photo by ${result.artist} on Unsplash. ${result.originalLink}`;

  const work = [result.artist, result.title, result.objectDate].filter(Boolean).join(", ");
  const collection = [result.source, result.licenseType].filter(Boolean).join(", ");
  return `${work}. ${collection}. ${result.originalLink}`;
}

export default function Lightbox({ result, onClose, onPrevious, onNext }: LightboxProps) {
  // Artist tools: see the image in values only, mirrored, or with a
  // rule-of-thirds grid -- common in reference tools, not in image search.
  const [valueView, setValueView] = useState(false);
  const [mirrored, setMirrored] = useState(false);
  const [grid, setGrid] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [copied, setCopied] = useState(false);
  const colorsCopy = useCopy();

  // Zoom and "Copied" are about one image; the tools stay on while stepping
  // through results, which is how they're used for comparing.
  useEffect(() => {
    setZoomed(false);
    setCopied(false);
  }, [result?.id]);

  useEffect(() => {
    if (!result) {
      return;
    }

    // Opening a photo full-size is how a user picks it as a reference.
    reportUnsplashDownload(result);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && onPrevious) onPrevious();
      if (event.key === "ArrowRight" && onNext) onNext();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [result, onClose, onPrevious, onNext]);

  if (!result) {
    return null;
  }

  // What the vision check saw: the kind of light (and whether it's
  // dramatic), the palette, then the reference categories.
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

  async function copyCredit() {
    try {
      await navigator.clipboard.writeText(creditLine(result!));
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_NOTICE_MS);
    } catch {
      // Clipboard blocked (e.g. not a secure page): nothing to show.
    }
  }

  function toggleZoom(event: MouseEvent<HTMLImageElement>) {
    // Zoom in where clicked; the zoomed view scrolls to that spot.
    const target = event.currentTarget;
    const x = event.nativeEvent.offsetX / target.clientWidth;
    const y = event.nativeEvent.offsetY / target.clientHeight;
    setZoomed((current) => !current);
    if (!zoomed) {
      requestAnimationFrame(() => {
        const frame = target.parentElement;
        if (!frame) return;
        frame.scrollLeft = x * frame.scrollWidth - frame.clientWidth / 2;
        frame.scrollTop = y * frame.scrollHeight - frame.clientHeight / 2;
      });
    }
  }

  const tools: { label: string; on: boolean; toggle: () => void }[] = [
    { label: "Values", on: valueView, toggle: () => setValueView((on) => !on) },
    { label: "Mirror", on: mirrored, toggle: () => setMirrored((on) => !on) },
    { label: "Grid", on: grid, toggle: () => setGrid((on) => !on) }
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

        <div className="lightbox-stage">
          {onPrevious && (
            <button type="button" className="lightbox-step is-previous" onClick={onPrevious} aria-label="Previous result">
              ‹
            </button>
          )}
          <div className={zoomed ? "lightbox-frame is-zoomed" : "lightbox-frame"}>
            <img
              className={["lightbox-image", valueView && "is-values", mirrored && "is-mirrored"].filter(Boolean).join(" ")}
              src={getExpandedImageUrl(result)}
              alt={result.title}
              onClick={toggleZoom}
            />
            {grid && !zoomed && <span className="lightbox-grid" aria-hidden="true" />}
          </div>
          {onNext && (
            <button type="button" className="lightbox-step is-next" onClick={onNext} aria-label="Next result">
              ›
            </button>
          )}
        </div>

        <div className="lightbox-info">
          <div className={isPhotoResult(result) ? "lightbox-title" : "lightbox-title is-artwork"}>{result.title}</div>
          <div className="lightbox-meta">
            {isPhotoResult(result) ? (
              <>
                Photo by <AttributionLink href={result.artistLink}>{result.artist}</AttributionLink>{" "}
                on <AttributionLink href={result.sourceLink}>Unsplash</AttributionLink>
              </>
            ) : (
              <>
                {result.artist}
                {result.objectDate ? `, ${result.objectDate}` : ""} ·{" "}
                <AttributionLink href={result.sourceLink}>{result.source}</AttributionLink>
              </>
            )}
            {result.licenseType && <span className="lightbox-license"> · {result.licenseType}</span>}
          </div>

          <div className="lightbox-tools" role="group" aria-label="View tools">
            {tools.map((tool) => (
              <button
                key={tool.label}
                type="button"
                className={tool.on ? "chip chip-small is-on" : "chip chip-small"}
                onClick={tool.toggle}
                aria-pressed={tool.on}
              >
                {tool.label}
              </button>
            ))}
          </div>

          {whyTags.length > 0 && (
            <div className="lightbox-why">
              <span className="lightbox-why-heading">
                Why this result <span className="lightbox-why-note">· AI-tagged</span>
              </span>
              <div className="tag-row">
                {whyTags.map((tag) => (
                  <span key={tag} className="info-tag">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Measured from the image's pixels, not by the AI. */}
          {palette.length > 0 && (
            <div className="lightbox-why">
              <span className="lightbox-why-heading">
                Main colors{" "}
                <button
                  type="button"
                  className="text-button colors-copy-all"
                  onClick={() => colorsCopy.copy(palette.map((swatch) => formatHex(swatch.color)).join(", "), "all")}
                >
                  {colorsCopy.copied ? "Copied" : "Copy all"}
                </button>
              </span>
              <div className="swatches" role="group" aria-label="Main colors">
                {palette.map((swatch) => (
                  <CopyableSwatch
                    key={swatch.color}
                    color={swatch.color}
                    className="swatch"
                    style={{ flexGrow: swatch.share }}
                    detail={`${Math.round(swatch.share * 100)}%`}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="lightbox-actions">
            <button type="button" className="text-button" onClick={copyCredit}>
              {copied ? "Copied" : "Copy credit"}
            </button>
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
    </div>
  );
}
