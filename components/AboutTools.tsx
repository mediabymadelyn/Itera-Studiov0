"use client";

import { useState } from "react";
import { useSlidingHighlight } from "@/components/useSlidingHighlight";

// The tools that help you study a reference, not just find it, shown as
// the same sliding, color-changing chips as the search page's filters.
// Pick one to read what it does.
const TOOLS = [
  { name: "Filters", text: "Narrow to art or photos, or to pose, lighting, color and more, with sub-tags like side light or warm color." },
  { name: "Why this result", text: "Open any image to see what the AI saw in it: the light, the colors and what it matched." },
  { name: "Values", text: "Shows the image in grayscale, to read its lights and darks." },
  { name: "Mirror", text: "Flips the image, to check a pose or proportions with fresh eyes." },
  { name: "Grid", text: "A rule-of-thirds overlay for studying composition." },
  { name: "Zoom", text: "Click the image to look closer at the spot you clicked." },
  { name: "Copy credit", text: "Copies a ready-made credit line for your notes or posts." },
  { name: "Palette", text: "The home page shows the five main colors of a different museum artwork on every visit." }
];

export default function AboutTools() {
  const [selected, setSelected] = useState(TOOLS[0].name);
  const highlight = useSlidingHighlight(selected);
  const tool = TOOLS.find((item) => item.name === selected) ?? TOOLS[0];

  return (
    <div className="about-tools">
      <div className="about-tool-chips" ref={highlight.groupRef} {...highlight.groupHandlers}>
        <span
          className={highlight.previewing ? "chip-highlight is-previewing" : "chip-highlight"}
          style={highlight.highlightStyle}
          aria-hidden="true"
        />
        {TOOLS.map((item) => {
          const active = item.name === selected;
          return (
            <button
              key={item.name}
              data-key={item.name}
              type="button"
              className={active ? "chip is-active" : "chip"}
              onClick={() => setSelected(item.name)}
              aria-pressed={active}
            >
              {item.name}
            </button>
          );
        })}
      </div>
      <p className="about-tool-text" aria-live="polite">
        <span className="about-tool-name">{tool.name}</span>
        {tool.text}
      </p>
    </div>
  );
}
