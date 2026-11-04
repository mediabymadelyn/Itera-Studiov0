import { ArtworkResult } from "@/lib/types/artwork";

// Photos already reported this page session, so reopening the same photo
// doesn't count as another download.
const reportedIds = new Set<string>();

/**
 * Tells Unsplash a user picked this photo to use (opened it as a reference
 * or clicked through to the original), as its API guidelines require. Never throws: a failed report must not
 * affect the UI.
 */
export function reportUnsplashDownload(result: ArtworkResult) {
  if (!result.downloadLocation || reportedIds.has(result.id)) return;
  reportedIds.add(result.id);

  fetch("/api/unsplash/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ downloadLocation: result.downloadLocation }),
    keepalive: true
  }).catch(() => {
    reportedIds.delete(result.id);
  });
}
