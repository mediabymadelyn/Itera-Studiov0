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
export function useSlidingHighlight(activeKey: string | null, layoutDeps: unknown[] = []) {
  const groupRef = useRef<HTMLDivElement>(null);
  const shown = useRef(false);
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
      const target = targetKey
        ? Array.from(group.querySelectorAll<HTMLElement>("[data-key]")).find(
            (element) => element.dataset.key === targetKey
          )
        : undefined;

      if (!target) {
        setHighlightStyle((current) => ({ ...current, opacity: 0 }));
        return;
      }

      setHighlightStyle({
        opacity: 1,
        width: target.offsetWidth,
        height: target.offsetHeight,
        transform: `translate(${target.offsetLeft}px, ${target.offsetTop}px)`,
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
      if (chip && !chip.matches(":disabled")) setHoverKey(chip.dataset.key ?? null);
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
