// AIC's own IIIF image host (www.artic.edu/iiif) currently blocks every
// hotlinked image request with a Cloudflare bot challenge. As a workaround
// for public-domain works, cross-reference AIC's accession ("main reference")
// number against Wikidata (P195 = Art Institute of Chicago, P217 = inventory
// number) to find a Wikimedia Commons-hosted copy instead. Coverage is
// partial -- well-documented/famous works are much more likely to have a
// match than minor ones -- so this is a best-effort supplement, not a
// replacement for AIC's own host.

const WIKIDATA_SPARQL_URL = "https://query.wikidata.org/sparql";
const ART_INSTITUTE_OF_CHICAGO_QID = "Q239303";
// Backstop only -- the caller (searchAicArtworks) is expected to pass a
// signal tied to its own, shorter branch-wide budget (see searchAll.ts).
const REQUEST_TIMEOUT_MS = 3000;

// Wikidata User-Agent policy asks for an identifiable client; see
// https://meta.wikimedia.org/wiki/User-Agent_policy
const USER_AGENT = "IteraStudioArtSearch/1.0 (local development project)";

type SparqlBinding = {
  invNumber?: { value: string };
  image?: { value: string };
};

type SparqlResponse = {
  results?: {
    bindings?: SparqlBinding[];
  };
};

function escapeSparqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildSparqlQuery(referenceNumbers: string[]): string {
  const values = referenceNumbers
    .map((ref) => `"${escapeSparqlString(ref)}"`)
    .join(" ");

  return `SELECT ?invNumber ?image WHERE {
    VALUES ?invNumber { ${values} }
    ?item wdt:P195 wd:${ART_INSTITUTE_OF_CHICAGO_QID} .
    ?item wdt:P217 ?invNumber .
    ?item wdt:P18 ?image .
  }`;
}

/**
 * Looks up Wikimedia Commons images for AIC works by accession number.
 * Returns a map of reference number -> Commons Special:FilePath image URL
 * (no width param; callers can append `?width=N` for a scaled version).
 * Never throws -- a failed/timed-out lookup just yields an empty map, so
 * callers fall back to their existing behavior for every reference number.
 */
export async function fetchAicCommonsImages(
  referenceNumbers: string[],
  externalSignal?: AbortSignal
): Promise<Map<string, string>> {
  const uniqueRefs = Array.from(new Set(referenceNumbers)).filter(Boolean);

  if (uniqueRefs.length === 0) {
    return new Map();
  }

  const query = buildSparqlQuery(uniqueRefs);
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);
  const signal = externalSignal
    ? AbortSignal.any([externalSignal, timeoutController.signal])
    : timeoutController.signal;

  try {
    const response = await fetch(
      `${WIKIDATA_SPARQL_URL}?query=${encodeURIComponent(query)}`,
      {
        headers: {
          Accept: "application/sparql-results+json",
          "User-Agent": USER_AGENT
        },
        signal,
        next: { revalidate: 3600 }
      }
    );

    if (!response.ok) {
      return new Map();
    }

    const data = (await response.json()) as SparqlResponse;
    const bindings = data.results?.bindings ?? [];

    const imagesByReference = new Map<string, string>();

    for (const binding of bindings) {
      const invNumber = binding.invNumber?.value;
      const image = binding.image?.value;

      if (invNumber && image && !imagesByReference.has(invNumber)) {
        imagesByReference.set(invNumber, image);
      }
    }

    return imagesByReference;
  } catch {
    return new Map();
  } finally {
    clearTimeout(timeout);
  }
}
