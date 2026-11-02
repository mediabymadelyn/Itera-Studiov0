"use client";

import { useEffect, useState } from "react";

// A plain "Loading results..." line was easy to miss and testers weren't
// sure anything was happening (P4, P5). This sits above the skeleton grid:
// three paint-swatch dots (colors cycle through the palette in CSS) plus a
// short label that follows the real stages of a search (see the
// SEARCH_TIMING_LOG breakdown in searchAll.ts): sources return in ~1-2s,
// then the relevance check and labeling take the rest.
const STEPS = [
  { afterMs: 0, label: "Checking your search" },
  { afterMs: 1200, label: "Searching sources" },
  { afterMs: 3000, label: "Checking results" }
];
const SLOW_NOTE_AFTER_MS = 15000;

export default function LoadingIndicator() {
  const [step, setStep] = useState(0);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timers = [
      ...STEPS.slice(1).map((s, index) => setTimeout(() => setStep(index + 1), s.afterMs)),
      setTimeout(() => setSlow(true), SLOW_NOTE_AFTER_MS)
    ];

    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="loading-status" role="status" aria-live="polite">
      <span className="swatch-dots" aria-hidden="true">
        <span className="swatch-dot" />
        <span className="swatch-dot" />
        <span className="swatch-dot" />
      </span>
      <span className="loading-label">{STEPS[step].label}…</span>
      {slow && <span className="loading-note">Detailed searches can take a little longer.</span>}
    </div>
  );
}
