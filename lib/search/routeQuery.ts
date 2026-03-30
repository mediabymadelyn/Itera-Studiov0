export type SourceName = "met" | "aic" | "unsplash";

const PHOTOGRAPHY_KEYWORDS = [
  "photo",
  "photography",
  "photograph",
  "street",
  "fashion",
  "modern",
  "editorial",
  "documentary",
  "camera",
  "real-world",
  "real world"
];

const MUSEUM_KEYWORDS = [
  "painting",
  "portrait",
  "sculpture",
  "museum",
  "classical",
  "oil",
  "renaissance",
  "baroque",
  "impressionist",
  "art history"
];

function containsKeyword(query: string, keywords: string[]): boolean {
  return keywords.some((keyword) => query.includes(keyword));
}

export function routeQueryToSources(query: string): SourceName[] {
  const normalizedQuery = query.toLowerCase();
  const isPhotography = containsKeyword(normalizedQuery, PHOTOGRAPHY_KEYWORDS);
  const isMuseumStyle = containsKeyword(normalizedQuery, MUSEUM_KEYWORDS);

  if (isPhotography && !isMuseumStyle) {
    return ["unsplash", "met", "aic"];
  }

  if (isMuseumStyle && !isPhotography) {
    return ["met", "aic", "unsplash"];
  }

  return ["met", "aic", "unsplash"];
}
