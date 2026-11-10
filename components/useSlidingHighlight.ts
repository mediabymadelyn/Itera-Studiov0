"use client";

import { CSSProperties, MouseEvent, useLayoutEffect, useRef, useState } from "react";
import { featuredPalette } from "@/components/featuredPaletteStore";

/**
 * One highlight per chip group that glides to whichever chip the pointer
 * is over, then settles back on the selected chip when the pointer leaves
 * the group (or fades out if nothing is selected). Put `groupRef` and
 * `groupHandlers` on the group (positioned, so it's the chips'
 * offsetParent), give each chip a matching `data-key`, and render an
 * element with `highlightStyle` inside the group; `previewing` is true
 * while it sits on a chip that isn't the selected one. `layoutDeps`
 * re-measures when the group appears or its chips change width (counts
 * change with the Show filter).
 */
// While sliding over chips that aren't selected, the highlight takes a
// color by chip position from this visit's featured artwork palette
// (components/FeaturedPalette), each landing a slightly different random
// mix; until a palette is picked, paint pigments (--paint-* in
// globals.css). Settled on the selected chip it's the brand purple again.
const PIGMENTS: [hue: number, saturation: number, lightness: number][] = [
  [4, 72, 48], // cadmium red
  [22, 82, 50], // cadmium orange
  [40, 68, 42], // yellow ochre (darker, so white text stays legible)
  [96, 40, 36], // sap green
  [164, 55, 32], // viridian
  [198, 68, 42], // cerulean
  [228, 62, 52], // ultramarine
  [272, 46, 46] // dioxazine violet
];
const MIX = { hue: 8, saturation: 6, lightness: 4 };

type Jitter = { hue: number; saturation: number; lightness: number };

function randomJitter(): Jitter {
  const spread = (range: number) => (Math.random() * 2 - 1) * range;
  return { hue: spread(MIX.hue), saturation: spread(MIX.saturation), lightness: spread(MIX.lightness) };
}

// Artwork palettes run from near-black umbers to ivory; their colors are
// brought into this lightness range (and given at least this saturation)
// so they read as color behind white text.
const PALETTE_LIGHTNESS: [number, number] = [32, 50];
const PALETTE_MIN_SATURATION = 28;

function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return [0, 0, lightness * 100];
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  const hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [(hue * 60 + 360) % 360, saturation * 100, lightness * 100];
}

function colorFor(index: number, count: number): [number, number, number] {
  const palette = featuredPalette();
  const source = palette && palette.length > 0 ? palette : null;
  const position = (length: number) => (count > 1 ? Math.round((index / (count - 1)) * (length - 1)) : 0);
  if (!source) return PIGMENTS[position(PIGMENTS.length)];

  const [hue, saturation, lightness] = hexToHsl(source[position(source.length)]);
  return [
    hue,
    Math.max(PALETTE_MIN_SATURATION, Math.min(70, saturation)),
    Math.max(PALETTE_LIGHTNESS[0], Math.min(PALETTE_LIGHTNESS[1], lightness))
  ];
}

function pigmentColors(index: number, count: number, jitter: Jitter) {
  const pigment = colorFor(index, count);
  const hue = (pigment[0] + jitter.hue + 360) % 360;
  const saturation = pigment[1] + jitter.saturation;
  const lightness = pigment[2] + jitter.lightness;
  return {
    backgroundColor: `hsl(${hue.toFixed(0)} ${saturation.toFixed(0)}% ${lightness.toFixed(0)}%)`,
    borderColor: `hsl(${hue.toFixed(0)} ${saturation.toFixed(0)}% ${(lightness + 16).toFixed(0)}%)`
  };
}

export function useSlidingHighlight(activeKey: string | null, layoutDeps: unknown[] = []) {
  const groupRef = useRef<HTMLDivElement>(null);
  const shown = useRef(false);
  const jitter = useRef<Jitter>(randomJitter());
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [highlightStyle, setHighlightStyle] = useState<CSSProperties>({ opacity: 0 });
  const targetKey = hoverKey ?? activeKey;

  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) {
      // A group that comes back (a new search, another category's
      // sub-tags) starts fresh rather than sliding from the old spot.
      shown.current = false;
      return;
    }

    const update = () => {
      const chips = Array.from(group.querySelectorAll<HTMLElement>("[data-key]"));
      const target = targetKey ? chips.find((element) => element.dataset.key === targetKey) : undefined;

      if (!target) {
        setHighlightStyle((current) => ({ ...current, opacity: 0 }));
        return;
      }

      const previewing = hoverKey !== null && hoverKey !== activeKey;
      setHighlightStyle({
        opacity: 1,
        width: target.offsetWidth,
        height: target.offsetHeight,
        transform: `translate(${target.offsetLeft}px, ${target.offsetTop}px)`,
        ...(previewing ? pigmentColors(chips.indexOf(target), chips.length, jitter.current) : {}),
        // The first time it appears, it should fade in at the chip, not
        // slide in from the group's corner.
        ...(shown.current ? {} : { transition: "opacity 0.2s ease" })
      });
      shown.current = true;
    };

    update();
    // Chips wrap to new lines as the window narrows; follow them.
    const observer = new ResizeObserver(update);
    observer.observe(group);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, ...layoutDeps]);

  const groupHandlers = {
    onMouseOver: (event: MouseEvent<HTMLElement>) => {
      const chip = (event.target as HTMLElement).closest<HTMLElement>("[data-key]");
      // Empty (disabled) chips can't be picked, so the highlight skips them.
      if (!chip || chip.matches(":disabled")) return;
      const key = chip.dataset.key ?? null;
      setHoverKey((current) => {
        // A new chip gets a new random shade; moving within one keeps it.
        if (current !== key) jitter.current = randomJitter();
        return key;
      });
    },
    onMouseLeave: () => setHoverKey(null)
  };

  return {
    groupRef,
    groupHandlers,
    highlightStyle,
    previewing: hoverKey !== null && hoverKey !== activeKey
  };
}
