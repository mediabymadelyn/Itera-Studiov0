"use client";

import { CSSProperties, useLayoutEffect, useRef, useState } from "react";

/**
 * One highlight per chip group that slides to the selected chip instead of
 * each chip switching color on its own. Put the returned ref on the group
 * (positioned, so it's the chips' offsetParent), give each chip a matching
 * `data-key`, and render an element with `highlightStyle` inside the group.
 * With nothing selected the highlight fades out where it was, so the next
 * selection slides from there. `layoutDeps` re-measures when the group
 * appears or its chips change width (counts change with the Show filter).
 */
export function useSlidingHighlight(activeKey: string | null, layoutDeps: unknown[] = []) {
  const groupRef = useRef<HTMLDivElement>(null);
  const shown = useRef(false);
  const [highlightStyle, setHighlightStyle] = useState<CSSProperties>({ opacity: 0 });

  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) {
      // A group that comes back (a new search, another category's
      // sub-tags) starts fresh rather than sliding from the old spot.
      shown.current = false;
      return;
    }

    const update = () => {
      const active = activeKey
        ? Array.from(group.querySelectorAll<HTMLElement>("[data-key]")).find(
            (element) => element.dataset.key === activeKey
          )
        : undefined;

      if (!active) {
        setHighlightStyle((current) => ({ ...current, opacity: 0 }));
        return;
      }

      setHighlightStyle({
        opacity: 1,
        width: active.offsetWidth,
        height: active.offsetHeight,
        transform: `translate(${active.offsetLeft}px, ${active.offsetTop}px)`,
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
  }, [activeKey, ...layoutDeps]);

  return { groupRef, highlightStyle };
}
