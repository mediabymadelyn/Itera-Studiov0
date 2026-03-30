import { ArtworkResult } from "@/lib/types/artwork";

type ResultCardProps = {
  result: ArtworkResult;
};

export default function ResultCard({ result }: ResultCardProps) {
  return (
    <article className="result-card">
      <img
        className="result-image"
        src={result.imageUrl}
        alt={result.title}
        loading="lazy"
      />
      <div className="result-content">
        <div className="result-title">{result.title}</div>
        <div className="result-meta">Artist: {result.artist}</div>
        <div className="result-meta">Source: {result.source}</div>
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
