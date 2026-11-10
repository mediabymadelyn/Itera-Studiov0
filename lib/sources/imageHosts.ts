// Where result images are served from: the Met, the Art Institute's
// Wikimedia Commons copies (and its own IIIF host), and Unsplash. Shared by
// saving (lib/saved/savedStore.ts), which only keeps images from these
// hosts, and the image download route (app/api/image), which only fetches
// from them.
export const IMAGE_HOSTS = [
  "images.metmuseum.org",
  "commons.wikimedia.org",
  "upload.wikimedia.org",
  "artic.edu",
  "images.unsplash.com",
  "plus.unsplash.com"
];

/** True for https URLs on one of these hosts or their subdomains. */
export function isSourceHost(url: URL, hosts: string[] = IMAGE_HOSTS): boolean {
  const host = url.hostname.toLowerCase();
  return url.protocol === "https:" && hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}
