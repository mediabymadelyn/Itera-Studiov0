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

  // For keyword-only baseline benchmarks: bypasses the lighting/composition
  // query translation in extractSubjectQuery() (see searchAll.ts). The env
  // var sets a session-wide default (e.g. in .env.local while benchmarking)
  // without touching the shipped default for normal app usage; the query
  // param always overrides it per-request either way.
  const disableQueryTranslationDefault =
    process.env.DISABLE_QUERY_TRANSLATION === "true";
  const disableQueryTranslationParam = request.nextUrl.searchParams.get(
    "disableQueryTranslation"
  );
  const disableQueryTranslation =
    disableQueryTranslationParam !== null
      ? disableQueryTranslationParam === "true"
      : disableQueryTranslationDefault;

  // The LLM rerank arm (see llmQueryLayer.ts / searchAll.ts). Omit the param
  // to use ENABLE_LLM_QUERY_LAYER's default; pass it explicitly to force
  // on/off per request for A/B benchmarking against the other two arms.
  const enableLlmRerankParam = request.nextUrl.searchParams.get("enableLlmRerank");
  const enableLlmRerank =
    enableLlmRerankParam !== null ? enableLlmRerankParam === "true" : undefined;

  try {
    const results = await searchAllArtworks(query, 6, {
      disableQueryTranslation,
      enableLlmRerank
    });

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json(
      { error: "Unable to fetch search results right now." },
      { status: 500 }
    );
  }
}
