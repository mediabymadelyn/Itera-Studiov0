import { ArtworkResult } from "@/lib/types/artwork";

// A board's main colors: every saved image's own main colors (measured
// from its pixels), near-identical ones merged, the most used first.
const BOARD_COLOR_COUNT = 8;
const SAME_COLOR_DISTANCE = 40;

export type Swatch = { color: string; share: number };

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

export function boardColors(results: ArtworkResult[]): Swatch[] {
  const merged: { rgb: [number, number, number]; color: string; share: number }[] = [];
  for (const result of results) {
    for (const swatch of result.imageMetrics?.palette ?? []) {
      const [r, g, b] = rgb(swatch.color);
      const weight = swatch.share / results.length;
      const near = merged.find(
        (entry) => Math.hypot(entry.rgb[0] - r, entry.rgb[1] - g, entry.rgb[2] - b) < SAME_COLOR_DISTANCE
      );
      if (near) near.share += weight;
      else merged.push({ rgb: [r, g, b], color: swatch.color, share: weight });
    }
  }
  const top = merged.sort((a, b) => b.share - a.share).slice(0, BOARD_COLOR_COUNT);
  const total = top.reduce((sum, entry) => sum + entry.share, 0) || 1;
  return top.map((entry) => ({ color: entry.color, share: entry.share / total }));
}
