// The palette of this visit's featured artwork (components/FeaturedPalette),
// read by the chip highlight (useSlidingHighlight) when it picks a color.
// Null until the page has picked one; the highlight falls back to paint
// pigments until then.
let palette: string[] | null = null;

export function setFeaturedPalette(colors: string[]): void {
  palette = colors;
}

export function featuredPalette(): string[] | null {
  return palette;
}
