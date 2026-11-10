"use client";

import { CSSProperties, useEffect, useRef, useState } from "react";

const COPIED_NOTICE_MS = 1400;

/** "#a34b2c" -> "#A34B2C", the way hex codes are usually written. */
export function formatHex(color: string): string {
  return color.toUpperCase();
}

/**
 * Copies text, giving `copied` for a moment afterwards. Clipboard blocked
 * (e.g. not a secure page): nothing happens and nothing is shown.
 */
export function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy(text: string, key: string = text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), COPIED_NOTICE_MS);
    } catch {
      // Clipboard unavailable.
    }
  }

  return { copied, copy };
}

type CopyableSwatchProps = {
  color: string;
  className: string;
  style?: CSSProperties;
  /** Shown after the hex code in the hover note, e.g. "34%". */
  detail?: string;
};

/**
 * One color you can copy: hovering (or focusing) shows its hex code and
 * "Copy", clicking copies the code and the note says "Copied". On touch
 * screens a tap copies and the note shows the same way.
 */
export default function CopyableSwatch({ color, className, style, detail }: CopyableSwatchProps) {
  const { copied, copy } = useCopy();
  const hex = formatHex(color);
  const note = copied ? `Copied ${hex}` : `${hex}${detail ? ` · ${detail}` : ""} · Copy`;

  return (
    <button
      type="button"
      className={`copy-swatch ${className}${copied ? " is-copied" : ""}`}
      style={{ ...style, background: color }}
      data-note={note}
      aria-label={copied ? `Copied ${hex}` : `Copy ${hex}`}
      onClick={() => copy(hex)}
    />
  );
}
