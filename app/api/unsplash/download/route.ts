import { NextRequest, NextResponse } from "next/server";

// Unsplash's API guidelines require calling a photo's download_location
// when a user picks it to use. This runs server-side so the access key is
// never sent to the browser. Only Unsplash download-tracking URLs are
// accepted, so the route can't be used to make arbitrary requests.
const DOWNLOAD_PATH_PATTERN = /^\/photos\/[A-Za-z0-9_-]+\/download$/;

function isUnsplashDownloadLocation(value: unknown): value is string {
  if (typeof value !== "string") return false;

  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "api.unsplash.com" &&
      DOWNLOAD_PATH_PATTERN.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) {
    return NextResponse.json({ error: "Unsplash is not configured." }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as { downloadLocation?: unknown } | null;
  if (!isUnsplashDownloadLocation(body?.downloadLocation)) {
    return NextResponse.json({ error: "Invalid download location." }, { status: 400 });
  }

  try {
    const response = await fetch(body.downloadLocation, {
      headers: { Authorization: `Client-ID ${accessKey}` },
      cache: "no-store"
    });

    if (!response.ok) {
      return NextResponse.json({ error: "Unsplash rejected the download event." }, { status: 502 });
    }

    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "Unable to reach Unsplash." }, { status: 502 });
  }
}
