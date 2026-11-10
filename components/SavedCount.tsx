"use client";

import { useEffect, useState } from "react";
import { useSaved } from "@/lib/saved/savedStore";

/** How many images are saved in this browser, next to the Saved link. */
export default function SavedCount() {
  const count = useSaved().items.length;
  // Saves are only known in the browser; render nothing on the server.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready || count === 0) return null;
  return <span className="navbar-count">{count}</span>;
}
