import { callModel, fastModel } from "@/lib/search/llmQueryLayer";
import { extractSubjectQuery } from "@/lib/search/visualTagBoost";
import {
  LightingIntent,
  LIGHTING_PHRASES,
  canBeSubject,
  contentTokens,
  detectAgeGroup,
  detectLightingIntent,
  statedBackground,
  statedBackgroundVariants,
  statedGender,
  withBackgroundFirst,
  isDemographicWord,
  isFillerWord,
  isMediumWord,
  isPeopleQuery,
  isSettingPreposition,
  lookupAction,
  museumSubjectTerm,
  queryAllowsObjects,
  settingMatchWords,
  backgroundVariants,
  isFaceSubject,
  MET_EUROPEAN_PAINTINGS,
  wantsMonochrome,
  hasStatedGender,
  isBodyPartSubject,
  queryWantsBlur,
  tokenize
} from "@/lib/search/queryTerms";

// Turns whatever the user typed into short, per-source searches. Sources
// disagree on how they treat multiple words: the Met's v1.1 search requires
// EVERY word to match (a 10-word prompt returns nothing -- the root of the
// "long queries load and then fail" bug), while AIC and Unsplash rank by
// relevance and cope with longer input. So every source gets a short query,
// and the Met gets a fallback chain that narrows to just the subject.

export type QueryPlan = {
  original: string;
  // The main thing to depict ("cat", "coffee cup"). Results that never
  // mention it are dropped by subjectFilter.ts.
  subject: string;
  subjectWords: string[];
  // Every word that counts as the action being present, e.g. backflip ->
  // flip/acrobat/tumbling. Empty when no action was asked for.
  actionWords: string[];
  // Every word that counts as the stated setting being present, e.g. city
  // -> street/urban/sidewalk. Empty when no setting was stated.
  settingWords: string[];
  // False unless the user asked for objects (statue, vase, cup...): then
  // 3D museum objects are capped and never the top pick.
  allowsObjects: boolean;
  // The user named a 2D medium ("charcoal", "oil painting"), so no 3D
  // objects at all rather than the usual couple.
  namesFlatMedium: boolean;
  // Content words of the whole request, used for ranking.
  rankWords: string[];
  // The background the user named for a people search ("black"), if any.
  // Its variant searches are then main results, not diversity extras.
  statedBackground: string | null;
  // The search asked for black-and-white images, which lifts the cap on
  // them in Best matches (see arrangeSections in searchAll.ts).
  wantsMonochrome: boolean;
  // For body-part subjects, what the body part is doing or holding
  // ("coffee", "cup" in "hands holding coffee cup"). Museums catalog the
  // scene, not the hands -- Pissarro's "Young Peasant Having Her Coffee"
  // never says "hands" -- so these also confirm the subject
  // (subjectFilter.ts) and get their own museum search. Empty otherwise.
  companionWords: string[];
  lighting: LightingIntent | null;
  ageGroup: ReturnType<typeof detectAgeGroup>;
  // Met: tried in order until one returns results.
  museumQueries: string[];
  museumSecondarySearches: MuseumSearch[];
  // AIC + Unsplash primary.
  keywordQuery: string;
  photoQuery: string;
  // Tighter subject + action photo search for compound queries.
  photoSecondaryQuery?: string;
  // One photo search per lighting pattern ("face side lit"), for lighting
  // searches that define patterns (see LightingIntent.photoPatterns).
  photoLightingQueries: string[];
  // Named-background variants of photoQuery for people queries, in the
  // order they should be spent (searchAll.ts decides how many run).
  photoBackgroundQueries: string[];
  // People query with no gender stated: searchAll.ts checks the first
  // results' captions and, if one gender clearly dominates, runs one more
  // search for the other (see underrepresentedGender in queryTerms.ts).
  balanceGender: boolean;
  // Searches using a body-part subject ("hands") phrase variants with skin
  // tones and possessives ("man's hands") instead of person backgrounds.
  bodyPartSubject: boolean;
  // Blurred photos are ranked lower and never the top pick unless the
  // query asked for blur or long exposure.
  allowsBlur: boolean;
  rewrittenByLlm: boolean;
};

// Enough variants for the largest per-search budget (see searchAll.ts).
const MAX_BACKGROUND_VARIANTS = 2;
// When the user named a background, the variant searches all look for it
// (see statedBackgroundVariants), so they get one more.
const MAX_STATED_BACKGROUND_VARIANTS = 3;

// Only long requests are worth an LLM round trip; short ones are already
// keyword-shaped and the word-based plan handles them fine.
const REWRITE_MIN_CONTENT_WORDS = 4;
const REWRITE_TIMEOUT_MS = 2000;
const MAX_KEYWORD_WORDS = 6;

const REWRITE_CACHE_MAX_SIZE = 500;
const rewriteCache = new Map<string, LlmRewrite>();

export type MuseumSearch = {
  // Tried in order until one returns results.
  queries: string[];
  departmentId?: number;
};

type LlmRewrite = {
  subject: string;
  action: string;
  setting: string;
  keywords: string;
};

type ParsedRequest = {
  subject: string;
  action: string;
  setting: string;
  // Art medium the user named ("oil painting", "charcoal"), kept out of the
  // subject; empty when the medium is all there is to search for.
  medium: string;
  keywords: string[];
};

function stripDescriptors(query: string): string {
  const withoutVisual = extractSubjectQuery(query).toLowerCase();

  return LIGHTING_PHRASES.reduce(
    (text, phrase) => text.split(phrase).join(" "),
    withoutVisual
  )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Word-based reading of the request: subject = first noun-like word (plus
 * an immediately following one, for "coffee cup"), action = first word in
 * the action table, setting = the word after "in"/"at"/"through".
 */
function parseDeterministically(strippedQuery: string): ParsedRequest {
  const tokens = tokenize(strippedQuery);
  const keywords = contentTokens(strippedQuery);

  let action = "";
  let setting = "";
  const subjectParts: string[] = [];
  const medium: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (isFillerWord(token) && !isSettingPreposition(token)) continue;

    if (isMediumWord(token)) {
      medium.push(token);
      continue;
    }

    if (isSettingPreposition(token)) {
      const next = tokens.slice(i + 1).find((t) => !isFillerWord(t));
      if (next && !setting && !lookupAction(next)) setting = next;
      continue;
    }

    if (!action && lookupAction(token)) {
      action = token;
      continue;
    }

    if (token === setting) continue;

    const previousWasSubject =
      subjectParts.length > 0 && tokens[i - 1] === subjectParts[subjectParts.length - 1];

    if (subjectParts.length === 0 && canBeSubject(token)) {
      subjectParts.push(token);
    } else if (subjectParts.length === 1 && previousWasSubject && canBeSubject(token)) {
      subjectParts.push(token);
    }
  }

  return {
    subject: subjectParts.join(" ") || medium.join(" ") || keywords[0] || strippedQuery,
    action,
    setting,
    medium: subjectParts.length > 0 ? medium.join(" ") : "",
    keywords
  };
}

function buildRewritePrompt(query: string): string {
  return (
    `An artist typed this into an art-reference image search: "${query}"\n\n` +
    `Break it into parts for a keyword search engine. Reply with ONLY a JSON object:\n` +
    `{"subject":"...","action":"...","setting":"...","keywords":"..."}\n\n` +
    `- subject: the main thing to depict, 1-2 words, using the user's own word ` +
    `(keep plural if they wrote plural, e.g. "hands").\n` +
    `- action: what the subject is doing, 1 word, or "" if nothing.\n` +
    `- setting: where it is, 1-2 words, or "" if not stated.\n` +
    `- keywords: 2-5 words a photo search engine would match, most important first.\n\n` +
    `Never add a gender, age, ethnicity or body type the user did not write ` +
    `(e.g. "dancer" stays "dancer", never "woman dancer"). No other text.`
  );
}

function cleanField(value: unknown, maxWords: number): string {
  if (typeof value !== "string") return "";

  return tokenize(value).slice(0, maxWords).join(" ");
}

function parseRewrite(raw: string): LlmRewrite | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const rewrite = {
      subject: cleanField(parsed.subject, 2),
      action: cleanField(parsed.action, 1),
      setting: cleanField(parsed.setting, 2),
      keywords: cleanField(parsed.keywords, MAX_KEYWORD_WORDS)
    };

    return rewrite.subject ? rewrite : null;
  } catch {
    return null;
  }
}

async function rewriteWithLlm(query: string): Promise<LlmRewrite | null> {
  const cacheKey = query.toLowerCase();
  const cached = rewriteCache.get(cacheKey);
  if (cached) return cached;

  const content = await callModel(
    buildRewritePrompt(query),
    120,
    REWRITE_TIMEOUT_MS,
    fastModel()
  );
  const rewrite = content ? parseRewrite(content) : null;

  if (rewrite) {
    if (rewriteCache.size >= REWRITE_CACHE_MAX_SIZE) rewriteCache.clear();
    rewriteCache.set(cacheKey, rewrite);
  }

  return rewrite;
}

/**
 * Applies an LLM rewrite on top of the word-based parse, but only keeps
 * what's grounded in the user's own words: the subject must come from the
 * query, and keywords may add synonyms but never a demographic word
 * (gender/age/background) the user didn't type.
 */
function mergeRewrite(parsed: ParsedRequest, rewrite: LlmRewrite, queryWords: Set<string>): ParsedRequest {
  const grounded = (text: string) =>
    tokenize(text).every((word) => queryWords.has(word) || queryWords.has(`${word}s`) || queryWords.has(word.replace(/s$/, "")));

  const keywords = tokenize(rewrite.keywords).filter(
    (word) => !isDemographicWord(word) || queryWords.has(word)
  );

  // A medium ("oil painting") is only the subject when the parse found
  // nothing else; the rewrite doesn't get to undo that.
  const mediumOnly = tokenize(rewrite.subject).every(isMediumWord) && parsed.medium !== "";
  const subject = rewrite.subject && grounded(rewrite.subject) && !mediumOnly ? rewrite.subject : parsed.subject;

  return {
    subject,
    medium: parsed.medium,
    action: rewrite.action && grounded(rewrite.action) ? rewrite.action : parsed.action,
    setting: rewrite.setting && grounded(rewrite.setting) ? rewrite.setting : parsed.setting,
    keywords: keywords.length > 0 ? keywords : parsed.keywords
  };
}

// Unsplash reads "girl"/"boy" loosely and mostly returns young adults (P6:
// "girl" returned adult women, "child" worked). "little girl" is how its
// photographers caption children, so the photo search says that instead.
function withChildQualifier(keywordQuery: string, queryTokens: string[]): string {
  const hasQualifier = queryTokens.some((token) => ["little", "young", "child", "kid", "toddler"].includes(token));
  if (hasQualifier) return keywordQuery;

  return keywordQuery.replace(/\b(girl|boy|girls|boys)\b/, "little $1");
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export type PlanOptions = {
  // Keyword-only benchmark arm: send the raw query, no stripping/rewrite.
  passthrough?: boolean;
  allowLlmRewrite?: boolean;
};

export async function planQuery(query: string, options: PlanOptions = {}): Promise<QueryPlan> {
  const lighting = detectLightingIntent(query);
  const stripped = options.passthrough ? query.toLowerCase() : stripDescriptors(query) || query.toLowerCase();
  let parsed = parseDeterministically(stripped);
  let rewrittenByLlm = false;

  if (
    !options.passthrough &&
    options.allowLlmRewrite &&
    parsed.keywords.length >= REWRITE_MIN_CONTENT_WORDS
  ) {
    const rewrite = await rewriteWithLlm(query);
    if (rewrite) {
      parsed = mergeRewrite(parsed, rewrite, new Set(tokenize(query)));
      rewrittenByLlm = true;
    }
  }

  const allTokens = tokenize(query);
  const action = parsed.action ? lookupAction(parsed.action) : null;
  const actionWords = parsed.action ? unique([parsed.action, ...(action?.match ?? [])]) : [];
  const actionSearch = action?.search ?? parsed.action;

  const keywordQuery = options.passthrough
    ? query
    : unique([...tokenize(parsed.subject), ...tokenize(parsed.action), ...parsed.keywords])
        .slice(0, MAX_KEYWORD_WORDS)
        .join(" ") || parsed.subject;

  const subjectWords = contentTokens(parsed.subject);
  const bodyPartSubject = isBodyPartSubject(subjectWords);
  const companionWords = bodyPartSubject
    ? contentTokens(stripped).filter((word) => !subjectWords.includes(word) && !actionWords.includes(word))
    : [];
  const museumSubject = museumSubjectTerm(parsed.subject);
  const museumQueries = options.passthrough
    ? [query]
    : unique([
        parsed.setting ? `${museumSubject} ${parsed.setting}` : "",
        // The Met matches the medium against its own medium/classification
        // fields: "figure charcoal" returns figure drawings.
        parsed.medium ? `${museumSubject} ${parsed.medium}` : "",
        museumSubject
      ]);

  const museumSecondarySearches: MuseumSearch[] = options.passthrough
    ? []
    : lighting
      ? lighting.metDepartmentIds.map((departmentId) => ({
          queries: [museumSubject],
          departmentId
        }))
      : actionSearch
        ? [{ queries: unique([`${museumSubject} ${actionSearch}`, actionSearch]) }]
        : [];
  // The Met's plain search for these words returns the objects themselves
  // (coffee cups, urns), so this one looks only at paintings.
  if (companionWords.length > 0 && !options.passthrough) {
    museumSecondarySearches.push({
      queries: unique([companionWords.join(" "), companionWords[0]]),
      departmentId: MET_EUROPEAN_PAINTINGS
    });
  }

  const basePhotoQuery = [
    withChildQualifier(keywordQuery, allTokens),
    lighting && !options.passthrough ? lighting.photoTerms : ""
  ]
    .filter(Boolean)
    .join(" ");

  // People queries spend their extra photo searches on diversity variants;
  // everything else gets a tighter subject + action search ("cat jumping"
  // for a long cat-in-the-jungle prompt), or -- when the main search
  // already was just subject + action ("hedgehog backflip") -- the action
  // alone, so a compound query still returns usable pose references for
  // the part that's hard to find.
  const peopleQuery = !options.passthrough && isPeopleQuery(allTokens);
  // A named background stays in front of the subject: the reordered
  // "dancer motion black" found 5 photos, "Black dancer motion" a full page.
  const background = peopleQuery ? statedBackground(query) : null;
  const photoQuery = background ? withBackgroundFirst(basePhotoQuery, background) : basePhotoQuery;
  const subjectActionQuery = parsed.action ? `${parsed.subject} ${parsed.action}` : "";
  const photoSecondaryQuery =
    !peopleQuery && parsed.action && !options.passthrough
      ? keywordQuery === subjectActionQuery
        ? parsed.action
        : subjectActionQuery
      : undefined;
  const photoLightingQueries =
    lighting?.photoPatterns && !options.passthrough
      ? lighting.photoPatterns.map((pattern, index) =>
          `${withChildQualifier(keywordQuery, allTokens)} ${
            index === 0 && !peopleQuery && lighting.nonPeoplePattern ? lighting.nonPeoplePattern : pattern
          }`
        )
      : [];
  const photoBackgroundQueries = !peopleQuery
    ? []
    : background
      ? statedBackgroundVariants(background, parsed.subject, MAX_STATED_BACKGROUND_VARIANTS, statedGender(allTokens))
      : backgroundVariants(query, photoQuery, bodyPartSubject, MAX_BACKGROUND_VARIANTS, isFaceSubject(subjectWords));

  return {
    original: query,
    subject: parsed.subject,
    subjectWords,
    actionWords,
    settingWords: parsed.setting ? settingMatchWords(parsed.setting) : [],
    allowsObjects: queryAllowsObjects(allTokens, bodyPartSubject),
    namesFlatMedium: allTokens.some(isMediumWord),
    rankWords: contentTokens(stripped),
    companionWords,
    wantsMonochrome: wantsMonochrome(query),
    statedBackground: background,
    lighting,
    ageGroup: detectAgeGroup(allTokens),
    museumQueries,
    museumSecondarySearches,
    keywordQuery,
    photoQuery,
    photoSecondaryQuery,
    photoLightingQueries,
    photoBackgroundQueries,
    balanceGender: peopleQuery && !hasStatedGender(allTokens),
    bodyPartSubject,
    allowsBlur: queryWantsBlur(allTokens),
    rewrittenByLlm
  };
}
