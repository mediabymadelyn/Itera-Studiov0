"use client";

import { CSSProperties, MouseEvent, useLayoutEffect, useRef, useState } from "react";

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
// While sliding over chips that aren't selected, the highlight runs
// through the rainbow by chip position (red at the first chip, violet at
// the last), each landing a slightly different random shade. Settled on
// the selected chip it's the brand purple again (from the stylesheet).
const RAINBOW_SPAN = 300;
const HUE_JITTER = 14;
const SATURATION = 68;
const LIGHTNESS = 52;
// Yellows and greens read light, so they go darker to keep white text legible.
const LIGHT_HUES: [number, number] = [40, 170];
const LIGHT_HUE_DARKENING = 10;

type Jitter = { hue: number; saturation: number; lightness: number };

function randomJitter(): Jitter {
  const spread = (range: number) => (Math.random() * 2 - 1) * range;
  return { hue: spread(HUE_JITTER), saturation: spread(8), lightness: spread(5) };
}

function rainbowColors(index: number, count: number, jitter: Jitter) {
  const hue = ((count > 1 ? (index / (count - 1)) * RAINBOW_SPAN : 0) + jitter.hue + 360) % 360;
  const darken = hue >= LIGHT_HUES[0] && hue <= LIGHT_HUES[1] ? LIGHT_HUE_DARKENING : 0;
  const saturation = SATURATION + jitter.saturation;
  const lightness = LIGHTNESS - darken + jitter.lightness;
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
        ...(previewing ? rainbowColors(chips.indexOf(target), chips.length, jitter.current) : {}),
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
