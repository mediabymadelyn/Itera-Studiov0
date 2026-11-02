// Builds lib/data/dramatic-lighting-works.json: paintings held by the Met or
// the Art Institute of Chicago that Wikidata ties to dramatic light --
// painted by an artist known for it, or tagged with a movement defined by it
// (tenebrism, the Caravaggisti, Utrecht Caravaggism). Search uses the list
// to supply museum results for "dramatic lighting" queries, because museum
// catalog text almost never describes lighting (see lib/search/curatedLighting.ts).
//
// Uses Wikidata's regular API (search + wbgetentities), not the SPARQL query
// service, which throttles heavily during outages. Run occasionally:
//   npm run build:lighting-list
//
// Note the list is heavily European and canonical by construction -- these
// are the traditions where "dramatic lighting" is a named, catalogued style.
// Search balances it with the non-Western department searches.

import { writeFileSync, mkdirSync } from "node:fs";

const API = "https://www.wikidata.org/w/api.php";
const USER_AGENT = "IteraStudioArtSearch/1.0 (lighting list build script)";
const OUTPUT = new URL("../lib/data/dramatic-lighting-works.json", import.meta.url);

const MUSEUMS = { met: "Q160236", aic: "Q239303" } as const;
const PAINTING = "Q3305213";

// Painters whose work is defined by dramatic, directional light.
const PAINTERS: Record<string, string> = {
  Q42207: "Caravaggio",
  Q5598: "Rembrandt",
  Q203371: "Georges de La Tour",
  Q214062: "Joseph Wright of Derby",
  Q297838: "Jusepe de Ribera",
  Q209615: "Francisco de Zurbarán",
  Q314548: "Gerard van Honthorst",
  Q874868: "Godfried Schalcken",
  Q335927: "Gerrit Dou",
  Q1337275: "Valentin de Boulogne"
};
// Resolved by name at build time (Wikidata IDs not hard-coded above).
const MORE_PAINTERS = [
  "Hendrick ter Brugghen",
  "Artemisia Gentileschi",
  "Orazio Gentileschi",
  "Dirck van Baburen",
  "Bartolomeo Manfredi",
  "Trophime Bigot",
  "Matthias Stom",
  "Adam Elsheimer",
  "Judith Leyster"
];
const MOVEMENTS: Record<string, string> = {
  Q1464842: "tenebrism",
  Q62506: "Caravaggisti",
  Q1628039: "Utrecht Caravaggism"
};

type Claims = Record<string, { mainsnak: { datavalue?: { value: unknown } } }[]>;
type Entity = { id: string; labels?: { en?: { value: string } }; claims?: Claims };

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Wikidata rate-limits bursts (HTTP 429), so requests are spaced out and
// retried with backoff, honoring Retry-After when given.
const REQUEST_SPACING_MS = 2000;
const MAX_ATTEMPTS = 6;

async function api(params: Record<string, string>): Promise<any> {
  const url = `${API}?${new URLSearchParams({ format: "json", ...params })}`;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (response.ok) {
        const data = await response.json();
        await pause(REQUEST_SPACING_MS);
        // API-level errors (e.g. lag during an outage) arrive as HTTP 200
        // with an error object; treat them like a failed request.
        if (!data.error) return data;
        console.warn(`  API error (${data.error.code}), retrying...`);
        await pause(5000 * (attempt + 1));
        continue;
      }
      const retryAfter = Number(response.headers.get("retry-after"));
      console.warn(`  HTTP ${response.status}, retrying...`);
      await pause(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000 * (attempt + 1));
    } catch (error) {
      console.warn(`  network error (${(error as Error).message}), retrying...`);
      await pause(5000 * (attempt + 1));
    }
  }

  throw new Error(`Wikidata API failed: ${url}`);
}

async function resolvePainter(name: string): Promise<string | null> {
  const data = await api({ action: "wbsearchentities", language: "en", type: "item", limit: "1", search: name });
  const hit = data.search?.[0];
  return hit && /painter|artist/i.test(hit.description ?? "") ? hit.id : null;
}

async function searchItems(statements: string[]): Promise<string[]> {
  const data = await api({
    action: "query",
    list: "search",
    srlimit: "100",
    srsearch: statements.map((s) => `haswbstatement:${s}`).join(" ")
  });
  return (data.query?.search ?? []).map((hit: { title: string }) => hit.title);
}

async function getEntities(ids: string[], props: string): Promise<Entity[]> {
  const entities: Entity[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const data = await api({
      action: "wbgetentities",
      ids: ids.slice(i, i + 50).join("|"),
      props,
      languages: "en"
    });
    entities.push(...Object.values(data.entities ?? {}) as Entity[]);
  }
  return entities;
}

function claimValues(entity: Entity, property: string): unknown[] {
  return (entity.claims?.[property] ?? [])
    .map((claim) => claim.mainsnak.datavalue?.value)
    .filter((value) => value !== undefined);
}

function itemIds(entity: Entity, property: string): string[] {
  return claimValues(entity, property)
    .map((value) => (value as { id?: string }).id)
    .filter((id): id is string => Boolean(id));
}

function firstString(entity: Entity, property: string): string | undefined {
  const value = claimValues(entity, property)[0];
  return typeof value === "string" ? value : undefined;
}

async function main() {
  for (const name of MORE_PAINTERS) {
    const id = await resolvePainter(name);
    if (id) PAINTERS[id] = name;
    else console.warn(`  could not resolve painter: ${name}`);
  }
  console.log(`${Object.keys(PAINTERS).length} painters, ${Object.keys(MOVEMENTS).length} movements`);

  const workIds = new Set<string>();
  for (const museum of Object.values(MUSEUMS)) {
    for (const painter of Object.keys(PAINTERS)) {
      for (const id of await searchItems([`P170=${painter}`, `P195=${museum}`, `P31=${PAINTING}`])) workIds.add(id);
    }
    for (const movement of Object.keys(MOVEMENTS)) {
      for (const id of await searchItems([`P135=${movement}`, `P195=${museum}`])) workIds.add(id);
    }
  }
  console.log(`${workIds.size} candidate works`);

  const works = await getEntities(Array.from(workIds), "claims|labels");
  const referenced = new Set<string>();
  for (const work of works) {
    for (const property of ["P170", "P136", "P180"]) itemIds(work, property).forEach((id) => referenced.add(id));
  }
  const labels = new Map(
    (await getEntities(Array.from(referenced), "labels")).map((entity) => [entity.id, entity.labels?.en?.value])
  );
  const label = (id: string) => labels.get(id) ?? PAINTERS[id];

  const entries = works
    .map((work) => {
      const metId = firstString(work, "P3634");
      const aicId = firstString(work, "P4610");
      const image = firstString(work, "P18");
      const creators = itemIds(work, "P170");
      const movements = itemIds(work, "P135").filter((id) => MOVEMENTS[id]);
      const base = {
        wikidataId: work.id,
        title: work.labels?.en?.value ?? "Untitled",
        artist: creators.map(label).filter(Boolean).join(", "),
        genres: itemIds(work, "P136").map(label).filter(Boolean),
        depicts: itemIds(work, "P180").map(label).filter(Boolean),
        reason: movements.length > 0
          ? `movement: ${movements.map((id) => MOVEMENTS[id]).join(", ")}`
          : `artist: ${creators.filter((id) => PAINTERS[id]).map((id) => PAINTERS[id]).join(", ")}`
      };

      if (metId) return { source: "met", objectId: metId, ...base };
      // AIC's own image host blocks hotlinking, so AIC works need a
      // Wikimedia Commons image (same workaround as wikidataAicImages.ts).
      if (aicId && image) {
        return {
          source: "aic",
          objectId: aicId,
          image: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(image.replace(/ /g, "_"))}`,
          ...base
        };
      }
      return null;
    })
    .filter((entry) => entry !== null)
    .sort((a, b) => a!.wikidataId.localeCompare(b!.wikidataId));

  mkdirSync(new URL("../lib/data/", import.meta.url), { recursive: true });
  writeFileSync(
    OUTPUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString().slice(0, 10),
        painterIds: Object.keys(PAINTERS).sort(),
        movementIds: Object.keys(MOVEMENTS).sort(),
        works: entries
      },
      null,
      2
    ) + "\n"
  );
  console.log(`wrote ${entries.length} works (${entries.filter((e) => e!.source === "met").length} Met, ${entries.filter((e) => e!.source === "aic").length} AIC)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
