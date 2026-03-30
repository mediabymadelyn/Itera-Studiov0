import { ArtworkResult } from "@/lib/types/artwork";

type ResultCardProps = {
  result: ArtworkResult;
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

export default function ResultCard({ result }: ResultCardProps) {
  const typeLabel = getTypeLabel(result.source);
  const creatorLabel = getCreatorLabel(result.source);

  return (
    <article className="result-card">
      <img
        className="result-image"
        src={result.imageUrl}
        alt={result.title}
        loading="lazy"
      />
      <div className="result-content">
        <div className="result-badges">
          <span className="result-badge">{typeLabel}</span>
        </div>
        <div className="result-title">{result.title}</div>
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
