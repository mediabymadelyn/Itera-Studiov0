import { NextRequest, NextResponse } from "next/server";
import { isSourceHost } from "@/lib/sources/imageHosts";

// Downloads one result's image as a file ("Download image" in the expanded
// view). Browsers won't save a picture from another site with a download
// link, so this fetches it and hands it back as an attachment. It only
// fetches from the three sources' image hosts (lib/sources/imageHosts.ts),
// also after redirects, only images, and only up to a size limit, so it
// can't be used to fetch anything else.
const USER_AGENT = "IteraStudioArtSearch/1.0 (image download)";
const MAX_BYTES = 30 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/tiff": "tif"
};

/** A plain file name from the title, without the extension. */
function fileName(raw: string | null): string {
  const name = (raw ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 _-]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return name || "itera-reference";
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("url");
  let url: URL;
  try {
    url = new URL(raw ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid image." }, { status: 400 });
  }
  if (!isSourceHost(url)) return NextResponse.json({ error: "Invalid image." }, { status: 400 });

  try {
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, cache: "no-store" });
    // Commons links redirect to upload.wikimedia.org; wherever it ended
    // up must still be an image host.
    const finalUrl = new URL(response.url || url.toString());
    const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!response.ok || !isSourceHost(finalUrl) || !type.startsWith("image/")) {
      return NextResponse.json({ error: "Couldn't get this image." }, { status: 502 });
    }
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) return NextResponse.json({ error: "Image too large." }, { status: 413 });

    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return NextResponse.json({ error: "Image too large." }, { status: 413 });

    const name = `${fileName(request.nextUrl.searchParams.get("name"))}.${EXTENSIONS[type] ?? "jpg"}`;
    return new NextResponse(body, {
      headers: {
        "Content-Type": type,
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch {
    return NextResponse.json({ error: "Couldn't get this image." }, { status: 502 });
  }
}
