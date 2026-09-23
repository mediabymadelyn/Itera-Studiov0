"use client";

import { useEffect } from "react";
import { ArtworkResult } from "@/lib/types/artwork";

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
          <div className="lightbox-meta">{result.artist}</div>
          <a
            className="result-link"
            href={result.originalLink}
            target="_blank"
            rel="noreferrer"
          >
            View original
          </a>
        </div>
      </div>
    </div>
  );
}
