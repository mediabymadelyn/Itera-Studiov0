import { NextRequest, NextResponse } from "next/server";
import { searchAllArtworks } from "@/lib/search/searchAll";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();

  if (!query) {
    return NextResponse.json(
      { error: "Missing required query parameter: q" },
      { status: 400 }
    );
  }

  try {
    const results = await searchAllArtworks(query, 6);

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json(
      { error: "Unable to fetch search results right now." },
      { status: 500 }
    );
  }
}
