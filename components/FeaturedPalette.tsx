"use client";

import { useEffect, useState } from "react";
import data from "@/lib/data/featured-palettes.json";
import { setFeaturedPalette } from "@/components/featuredPaletteStore";

type FeaturedWork = {
  id: string;
  title: string;
  artist: string;
  link: string;
  colors: string[];
};

const works = data.works as FeaturedWork[];

/**
 * Five paint chips with one museum artwork's palette, a different work on
 * each visit (lib/data/featured-palettes.json, built from the museum
 * library). The pick happens after the page loads, so the server and the
 * browser agree on the first render; the chips fade in once it's made. The
 * same colors go to the section dividers (--palette-1..5) and the chip
 * highlight (featuredPaletteStore).
 */
export default function FeaturedPalette() {
  const [work, setWork] = useState<FeaturedWork | null>(null);

  useEffect(() => {
    if (works.length === 0) return;
    const pick = works[Math.floor(Math.random() * works.length)];
    setWork(pick);
    setFeaturedPalette(pick.colors);
    pick.colors.forEach((color, index) =>
      document.documentElement.style.setProperty(`--palette-${index + 1}`, color)
    );
  }, []);

  return (
    <figure className={work ? "featured-palette is-ready" : "featured-palette"}>
      <div className="palette-chips" aria-hidden="true">
        {(work?.colors ?? ["", "", "", "", ""]).map((color, index) => (
          <span key={index} className="palette-chip" style={color ? { background: color } : undefined} title={color} />
        ))}
      </div>
      <figcaption className="palette-caption">
        {work ? (
          <>
            <span className="palette-label">Color palette</span> · the five main colors of{" "}
            <a href={work.link} target="_blank" rel="noreferrer" className="attribution-link">
              <em>{work.title}</em>, {work.artist}
            </a>
            . A new artwork every visit.
          </>
        ) : (
          " "
        )}
      </figcaption>
    </figure>
  );
}
