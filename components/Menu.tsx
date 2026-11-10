"use client";

import { ReactNode, useEffect, useRef, useState } from "react";

/**
 * A button that opens a small panel under it (Download, Add to board, the
 * board's ⋯). Closes on a click outside or Escape -- Escape closes only the
 * menu, not an expanded view behind it.
 */
export default function Menu({
  label,
  buttonClassName = "text-button",
  ariaLabel,
  align = "start",
  children
}: {
  label: ReactNode;
  buttonClassName?: string;
  ariaLabel?: string;
  align?: "start" | "end" | "center";
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    // Capture phase, so it runs before the expanded view's own Escape.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className={buttonClassName}
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>
      {open && <div className={`menu-panel is-${align}`}>{children(() => setOpen(false))}</div>}
    </div>
  );
}
