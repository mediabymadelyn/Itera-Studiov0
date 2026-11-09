import { ArtworkResult } from "@/lib/types/artwork";

// Small, hand-maintained vocabulary tables used by query planning
// (queryPlan.ts) and ranking (rankResults.ts / subjectFilter.ts). Kept
// deliberately literal and short, in the same spirit as routeQuery.ts --
// each table only covers terms that came up in user testing.

// Words that carry no subject meaning in a natural-language request. Long
// queries are common (4/6 testers wrote 10+ words), and the Met's search
// requires every word to match, so these must never reach a source API.
const FILLER_WORDS = new Set([
  "a", "an", "and", "are", "art", "as", "at", "be", "being", "by", "doing",
  "for", "from", "has", "have", "her", "his", "image", "images", "in", "into",
  "is", "it", "its", "like", "looking", "of", "on", "onto", "or", "over",
  "photo", "photos", "picture", "pictures", "reference", "references",
  "showing", "some", "that", "the", "their", "them", "there", "this", "to",
  "under", "up", "very", "while", "who", "with", "someone", "something",
  "really", "kind", "sort", "want", "need", "find", "me", "my", "i",
  "through", "inside", "across", "near", "coming", "lighting", "mid"
]);

// Prepositions that usually introduce the setting ("cat in the jungle").
const SETTING_PREPOSITIONS = new Set(["in", "at", "through", "inside", "across", "near"]);

// Common adjectives that should never be picked as the subject when the
// deterministic plan has to guess ("curly hair girl" -> subject "girl" is
// still wrong, but "curly" is worse). Not exhaustive by design.
const NON_SUBJECT_WORDS = new Set([
  "big", "small", "little", "tiny", "large", "old", "young", "new", "dark",
  "bright", "light", "soft", "hard", "warm", "cold", "busy", "quiet", "dramatic",
  "moody", "beautiful", "curly", "straight", "long", "short", "tall", "red",
  "blue", "green", "yellow", "black", "white", "brown", "pink", "purple",
  "orange", "gray", "grey", "golden", "close", "closeup", "close-up", "wide",
  "high", "low", "contrast", "lighting", "lit", "shadow", "shadows", "dynamic",
  "full", "body", "side", "front", "back", "view", "angle"
]);

// Art media and formats: what the work is made with, not what it shows.
// Picking one as the subject sent the Met "oil" for "oil painting portrait"
// and every result was an oil lamp. They're kept as a separate medium part
// of the plan instead, and only become the subject when nothing else in
// the query can be ("oil painting").
const MEDIUM_WORDS = new Set([
  "oil", "oils", "watercolor", "watercolors", "watercolour", "watercolours",
  "acrylic", "acrylics", "gouache", "tempera", "pastel", "pastels",
  "charcoal", "graphite", "pencil", "ink", "crayon", "chalk", "fresco",
  "painting", "paintings", "drawing", "drawings", "sketch", "sketches",
  "etching", "engraving", "woodcut", "lithograph"
]);

export function isMediumWord(token: string): boolean {
  return MEDIUM_WORDS.has(token);
}

// --- Lighting -------------------------------------------------------------
// Museum metadata essentially never says "dramatic lighting", so museum
// lighting searches go to the departments where lighting is a property of
// the work at all -- painting and photography -- and candlelit/night scenes
// plus a handful of painters known for dramatic light rank higher.
// ("chiaroscuro" was tried and dropped: in the Met's catalog it almost
// always means the chiaroscuro woodcut printing technique, not lighting.)
// Unsplash's own search understands photographic lighting terms directly,
// so photos get the user's phrase plus "low key" instead.
export type LightingIntent = {
  // "dramatic" also draws on the curated list of works known for dramatic
  // light (see lightingCatalog.ts); "rays" has no catalogued equivalent.
  kind: "dramatic" | "rays";
  photoTerms: string;
  aicTerm: string;
  metDepartmentIds: number[];
  // Extra photo searches, one per lighting pattern, each added to the
  // subject ("face side lit"). Unsplash's "low key" alone returned almost
  // only black-and-white studio portraits. The first is swapped for
  // nonPeoplePattern when the subject isn't a person.
  photoPatterns?: string[];
  nonPeoplePattern?: string;
  rankTerms: string[];
  rankArtists: string[];
};

export const MET_EUROPEAN_PAINTINGS = 11;
const MET_PHOTOGRAPHS = 19;

const DRAMATIC_LIGHTING_PHRASES = [
  "dramatic lighting", "dramatic light", "chiaroscuro", "tenebrism",
  "high contrast", "light and shadow", "light and shadows", "harsh shadows",
  "strong shadows", "deep shadows", "hard light", "low key", "low-key",
  "moody lighting", "dark lighting", "single light source"
];

const LIGHT_RAY_PHRASES = ["sun rays", "sunrays", "light rays", "god rays", "sunbeams", "sunbeam"];

const DRAMATIC_LIGHTING: LightingIntent = {
  kind: "dramatic",
  photoTerms: "dramatic lighting",
  aicTerm: "candlelight",
  // None: the pre-scored museum library (lib/search/museumLibrary.ts)
  // supplies dramatic museum works without any Met requests at search time.
  metDepartmentIds: [],
  photoPatterns: ["Rembrandt lighting", "side lit", "chiaroscuro", "colorful dramatic light"],
  nonPeoplePattern: "single light source",
  rankTerms: [
    "candle", "candlelight", "candlelit", "night", "nocturne",
    "lamp", "lamplight", "torch", "torchlight", "firelight", "moonlight",
    "shadow", "shadows", "dark", "darkness"
  ],
  rankArtists: [
    "caravaggio", "rembrandt", "georges de la tour", "joseph wright",
    "honthorst", "ribera", "zurbarán", "zurbaran", "terbrugghen",
    "ter brugghen", "schalcken", "gerrit dou", "artemisia gentileschi",
    "manfredi"
  ]
};

const LIGHT_RAYS: LightingIntent = {
  kind: "rays",
  photoTerms: "sun rays",
  aicTerm: "sunlight",
  metDepartmentIds: [MET_EUROPEAN_PAINTINGS, MET_PHOTOGRAPHS],
  rankTerms: ["sunlight", "sunbeam", "rays", "sunrise", "sunset", "dawn", "light"],
  rankArtists: []
};

export function detectLightingIntent(query: string): LightingIntent | null {
  const normalized = query.toLowerCase();

  if (DRAMATIC_LIGHTING_PHRASES.some((phrase) => normalized.includes(phrase))) {
    return DRAMATIC_LIGHTING;
  }

  if (LIGHT_RAY_PHRASES.some((phrase) => normalized.includes(phrase))) {
    return LIGHT_RAYS;
  }

  return null;
}

export const LIGHTING_PHRASES = [...DRAMATIC_LIGHTING_PHRASES, ...LIGHT_RAY_PHRASES];

// --- Actions --------------------------------------------------------------
// Key: any form the user might type. `search` is the single term most likely
// to exist in source metadata (used for the action-only fallback search),
// `match` is everything that counts as the action being present.
type ActionEntry = { search: string; match: string[] };

const MOTION_WORDS = [
  "motion", "movement", "moving", "midair", "air", "leap", "leaping", "jump",
  "jumping", "spin", "spinning", "twirl", "twirling", "action", "dynamic", "mid"
];

const ACTION_TABLE: Record<string, ActionEntry> = {
  backflip: { search: "acrobat", match: ["backflip", "flip", "acrobat", "acrobats", "acrobatic", "acrobatics", "tumbling", "tumbler", "somersault"] },
  flip: { search: "acrobat", match: ["flip", "acrobat", "acrobats", "acrobatic", "tumbling", "somersault"] },
  jump: { search: "leaping", match: ["jump", "jumps", "jumping", "leap", "leaps", "leaping", "pounce", "pouncing"] },
  jumping: { search: "leaping", match: ["jump", "jumps", "jumping", "leap", "leaps", "leaping", "pounce", "pouncing"] },
  leaping: { search: "leaping", match: ["jump", "jumping", "leap", "leaping"] },
  fly: { search: "flight", match: ["fly", "flying", "flight", "soaring", "wings", "airborne"] },
  flying: { search: "flight", match: ["fly", "flying", "flight", "soaring", "wings", "airborne"] },
  run: { search: "running", match: ["run", "runs", "running", "runner", "sprint", "sprinting"] },
  running: { search: "running", match: ["run", "runs", "running", "runner", "sprint", "sprinting"] },
  dance: { search: "dancing", match: ["dance", "dances", "dancing", "dancer", "dancers", "ballet"] },
  dancing: { search: "dancing", match: ["dance", "dances", "dancing", "dancer", "dancers", "ballet"] },
  walk: { search: "walking", match: ["walk", "walks", "walking", "stroll", "strolling"] },
  walking: { search: "walking", match: ["walk", "walks", "walking", "stroll", "strolling", "promenade"] },
  climb: { search: "climbing", match: ["climb", "climbs", "climbing", "climber"] },
  climbing: { search: "climbing", match: ["climb", "climbs", "climbing", "climber"] },
  swim: { search: "swimming", match: ["swim", "swims", "swimming", "swimmer", "bathers"] },
  swimming: { search: "swimming", match: ["swim", "swims", "swimming", "swimmer", "bathers"] },
  fall: { search: "falling", match: ["fall", "falls", "falling", "fallen"] },
  falling: { search: "falling", match: ["fall", "falls", "falling", "fallen"] },
  fight: { search: "battle", match: ["fight", "fighting", "battle", "combat", "struggle", "wrestling"] },
  fighting: { search: "battle", match: ["fight", "fighting", "battle", "combat", "struggle", "wrestling"] },
  sit: { search: "seated", match: ["sit", "sitting", "seated"] },
  sitting: { search: "seated", match: ["sit", "sitting", "seated"] },
  recline: { search: "reclining", match: ["reclining", "lying", "resting"] },
  reclining: { search: "reclining", match: ["reclining", "lying", "resting"] },
  lying: { search: "reclining", match: ["reclining", "lying", "resting"] },
  hold: { search: "holding", match: ["hold", "holds", "holding"] },
  holding: { search: "holding", match: ["hold", "holds", "holding"] },
  ride: { search: "riding", match: ["ride", "rides", "riding", "rider", "equestrian"] },
  riding: { search: "riding", match: ["ride", "rides", "riding", "rider", "equestrian"] },
  stretch: { search: "stretching", match: ["stretch", "stretching"] },
  stretching: { search: "stretching", match: ["stretch", "stretching"] },
  kneel: { search: "kneeling", match: ["kneel", "kneeling"] },
  kneeling: { search: "kneeling", match: ["kneel", "kneeling"] },
  throw: { search: "throwing", match: ["throw", "throwing", "thrower"] },
  throwing: { search: "throwing", match: ["throw", "throwing", "thrower"] },
  // "dancer mid motion" (P1: motion was hard to find).
  motion: { search: "movement", match: MOTION_WORDS },
  movement: { search: "movement", match: MOTION_WORDS },
  moving: { search: "movement", match: MOTION_WORDS },
  midair: { search: "leaping", match: MOTION_WORDS },
  spinning: { search: "spinning", match: ["spin", "spins", "spinning", "twirl", "twirling", "pirouette"] },
  twirling: { search: "spinning", match: ["spin", "spins", "spinning", "twirl", "twirling", "pirouette"] }
};

export function lookupAction(word: string): ActionEntry | null {
  return ACTION_TABLE[word.toLowerCase()] ?? null;
}

// --- People ---------------------------------------------------------------
// Literal age matching: an age word only ever matches its own age group.
// Gender is only matched when the user typed it -- nothing here ever adds a
// gendered term to a neutral query like "dancer" or "person".
type AgeGroup = "child" | "teen" | "elder";

const AGE_GROUPS: Record<AgeGroup, { queryWords: string[]; match: string[] }> = {
  child: {
    queryWords: ["girl", "girls", "boy", "boys", "child", "children", "kid", "kids", "toddler", "toddlers"],
    match: ["girl", "girls", "boy", "boys", "child", "children", "kid", "kids", "toddler", "young", "little", "daughter", "son", "infant", "baby", "childhood", "schoolgirl", "schoolboy"]
  },
  teen: {
    queryWords: ["teen", "teens", "teenager", "teenagers", "adolescent"],
    match: ["teen", "teens", "teenager", "teenagers", "adolescent", "youth", "young"]
  },
  elder: {
    queryWords: ["elderly", "elder", "grandmother", "grandfather", "senior"],
    match: ["elderly", "elder", "old", "aged", "grandmother", "grandfather", "senior"]
  }
};

const ADULT_WORDS = ["woman", "women", "man", "men", "lady", "ladies", "gentleman", "adult", "adults", "wife", "husband", "bride", "groom"];

export function detectAgeGroup(tokens: string[]): AgeGroup | null {
  for (const [group, entry] of Object.entries(AGE_GROUPS) as [AgeGroup, (typeof AGE_GROUPS)[AgeGroup]][]) {
    if (tokens.some((token) => entry.queryWords.includes(token))) {
      return group;
    }
  }

  return null;
}

export function ageGroupMatchWords(group: AgeGroup): string[] {
  return AGE_GROUPS[group].match;
}

export function adultWords(): string[] {
  return ADULT_WORDS;
}

// Any of these means the query is about people, so a photo-side diversity
// variant is worth running (see backgroundVariants below).
const PERSON_WORDS = new Set([
  "person", "people", "man", "men", "woman", "women", "girl", "girls", "boy",
  "boys", "child", "children", "kid", "kids", "teen", "teenager", "baby",
  "dancer", "dancers", "ballerina", "ballerinas", "athlete", "athletes", "musician", "musicians",
  "model", "figure", "figures", "portrait", "portraits", "face", "faces",
  "hand", "hands", "student", "students", "worker", "workers", "family",
  "couple", "crowd", "elderly", "grandmother", "grandfather", "skater",
  "runner", "swimmer", "boxer", "singer", "artist", "mother", "father"
]);

// If the user already named a background, the variant would override what
// they asked for, so it's skipped.
const STATED_BACKGROUND_WORDS = [
  "black", "african", "african american", "afro latina", "afro latino",
  "asian", "east asian", "south asian", "southeast asian", "indian",
  "latina", "latino", "latinx", "hispanic", "mexican", "latin american",
  "middle eastern", "arab", "indigenous", "native", "native american",
  "first nations", "native hawaiian", "pacific islander", "white",
  "european", "caucasian", "chinese", "japanese", "korean", "filipino",
  "vietnamese"
];
// Color words name a background only right before a person ("black
// dancer", "a white woman"): "woman in a black dress", "black and white
// portrait" and "white horse" are about color. Body parts and "portrait"
// don't count as the person here ("black face" reads as blackface).
const COLOR_BACKGROUND_WORDS = ["black", "white"];
const NOT_A_PERSON_AFTER_COLOR = new Set(["portrait", "portraits", "face", "faces", "hand", "hands", "figure", "figures"]);
// Subjects that already are the person, so variants don't add another.
const GENERIC_PERSON_WORDS = new Set([
  "man", "men", "woman", "women", "person", "people", "girl", "girls", "boy", "boys",
  "child", "children", "kid", "kids", "lady", "ladies"
]);

// Unsplash results skew heavily toward white subjects (P5, P6) and, for
// some subjects, toward one gender (P4: all women for "dancer"). Rather
// than guessing anyone's background or gender from an image, extra searches
// ask Unsplash for named variants of the same query and add those to the
// pool (see searchAll.ts for the per-search budget). Body-part queries
// ("hands holding coffee cup") use skin-tone wording, which is how
// Unsplash photographers caption them; person queries use backgrounds.
// The starting point rotates by query, so a given search is deterministic
// (and cacheable) but different searches cover different groups.
const PERSON_DESCRIPTORS = ["Black", "East Asian", "South Asian", "Latin American", "Middle Eastern", "Indigenous"];
const SKIN_DESCRIPTORS = ["Black", "dark skin", "brown skin", "tan skin", "East Asian", "olive skin"];

const BODY_PART_WORDS = new Set([
  "hand", "hands", "face", "faces", "foot", "feet", "arm", "arms", "leg", "legs",
  "skin", "eye", "eyes", "lips", "fingers", "back", "shoulder", "shoulders"
]);

const FEMALE_WORDS = ["woman", "women", "girl", "girls", "female", "lady", "ladies", "she", "her", "ballerina", "mother", "bride"];
const MALE_WORDS = ["man", "men", "boy", "boys", "male", "guy", "guys", "he", "his", "gentleman", "father", "groom"];

export function isBodyPartSubject(subjectWords: string[]): boolean {
  return subjectWords.some((word) => BODY_PART_WORDS.has(word));
}

export function hasStatedGender(tokens: string[]): boolean {
  return statedGender(tokens) !== null;
}

export function statedGender(tokens: string[]): "female" | "male" | null {
  if (tokens.some((token) => FEMALE_WORDS.includes(token))) return "female";
  if (tokens.some((token) => MALE_WORDS.includes(token))) return "male";
  return null;
}

const FACE_WORDS = new Set(["face", "faces"]);
// Face variants alternate these, one per variant.
const FACE_VARIANT_PEOPLE = ["woman's", "man's"];

export function isFaceSubject(subjectWords: string[]): boolean {
  return subjectWords.some((word) => FACE_WORDS.has(word));
}

export function backgroundVariants(
  query: string,
  baseQuery: string,
  bodyPart: boolean,
  count: number,
  face = false
): string[] {
  // Faces name the person, not the skin: "Black face dramatic low key"
  // reads as black face paint (and echoes "blackface") and returned one
  // face-paint shoot, while "Black woman's face dramatic low key" returns
  // portraits of Black women in low light.
  const descriptors = bodyPart && !face ? SKIN_DESCRIPTORS : PERSON_DESCRIPTORS;
  const start = stableHash(query.toLowerCase()) % descriptors.length;

  return Array.from({ length: Math.min(count, descriptors.length) }, (_, offset) => {
    const descriptor = descriptors[(start + offset) % descriptors.length];
    return face
      ? `${descriptor} ${FACE_VARIANT_PEOPLE[offset % FACE_VARIANT_PEOPLE.length]} ${baseQuery}`
      : `${descriptor} ${baseQuery}`;
  });
}

/**
 * Which gender is clearly under-represented in a result set, judged only
 * from the words in each result's caption -- never from the image. Returns
 * null when captions don't say enough or the split is already reasonable.
 */
export function underrepresentedGender(results: ArtworkResult[]): "female" | "male" | null {
  let female = 0;
  let male = 0;

  for (const result of results) {
    const words = resultWords(result);
    if (FEMALE_WORDS.some((word) => words.has(word))) female++;
    if (MALE_WORDS.some((word) => words.has(word))) male++;
  }

  if (female >= 3 && female >= male * 2) return "male";
  if (male >= 3 && male >= female * 2) return "female";
  return null;
}

export function genderVariant(baseQuery: string, gender: "female" | "male", bodyPart: boolean): string {
  if (bodyPart) return `${gender === "male" ? "man's" : "woman's"} ${baseQuery}`;
  return `${gender} ${baseQuery}`;
}

const GENDERED_WORDS = ["female", "male", "girl", "girls", "boy", "boys", "mother", "father", "daughter", "son"];

// Words an automated rewrite must never introduce on its own (see
// queryPlan.ts mergeRewrite) -- only the user gets to specify these.
export function isDemographicWord(word: string): boolean {
  return (
    GENDERED_WORDS.includes(word) ||
    ADULT_WORDS.includes(word) ||
    STATED_BACKGROUND_WORDS.includes(word) ||
    Object.values(AGE_GROUPS).some((group) => group.queryWords.includes(word) || group.match.includes(word))
  );
}

export function isPeopleQuery(tokens: string[]): boolean {
  return tokens.some((token) => PERSON_WORDS.has(token));
}

/**
 * The background the user named for a person ("african american",
 * "black"), longest phrase first, so "african american dancer" is one
 * background and the subject stays "dancer". Null when none is named.
 */
export function statedBackground(query: string): string | null {
  const tokens = tokenize(query);
  const phrases = [...STATED_BACKGROUND_WORDS].sort((a, b) => b.split(" ").length - a.split(" ").length);

  for (const phrase of phrases) {
    const words = phrase.split(" ");
    for (let i = 0; i + words.length <= tokens.length; i++) {
      if (!words.every((word, k) => tokens[i + k] === word)) continue;
      if (COLOR_BACKGROUND_WORDS.includes(phrase)) {
        if (wantsMonochrome(query)) continue;
        const next = tokens.slice(i + 1).find((token) => !isFillerWord(token));
        if (!next || !PERSON_WORDS.has(next) || NOT_A_PERSON_AFTER_COLOR.has(next)) continue;
      }
      return phrase;
    }
  }
  return null;
}

/** The text with the background phrase taken out, for choosing the subject. */
export function withoutBackground(text: string, background: string): string {
  const words = background.split(" ");
  const tokens = tokenize(text);
  const start = tokens.findIndex((_, i) => words.every((word, k) => tokens[i + k] === word));
  return start === -1 ? text : [...tokens.slice(0, start), ...tokens.slice(start + words.length)].join(" ");
}

// Other ways photographers caption the same background, tried as one more
// search ("African American dancer" found as many full matches as "Black
// dancer in motion" for "black dancer mid motion").
const BACKGROUND_SEARCH_SYNONYMS: Record<string, string> = { black: "African American", "african american": "Black" };

const titleCase = (text: string) => text.replace(/\b\w/g, (letter) => letter.toUpperCase());

// "dancer" -> "dancing", "swimmer" -> "swimming": photos of people doing
// something are captioned by the activity ("Black woman dancing").
function activityOf(subject: string): string {
  return subject.endsWith("er") && subject.length - 2 >= 4 ? `${subject.slice(0, -2)}ing` : subject;
}

/**
 * Variant photo searches for a people search that names a background
 * ("black dancer mid motion"). The plain search returned 5 photos, mostly
 * of people in black clothes: Unsplash captions rarely state ethnicity, so
 * "black" matched the clothing. Person phrasing finds what the user asked
 * for ("Black woman dancing", "Black man dancing"), plus a synonym.
 */
export function statedBackgroundVariants(
  background: string,
  subject: string,
  count: number,
  gender: "female" | "male" | null = null,
  action = ""
): string[] {
  const descriptor = titleCase(background);
  const synonym = BACKGROUND_SEARCH_SYNONYMS[background];
  const withAction = (text: string) => (action ? `${text} ${action}` : text);

  // The subject already is the person ("south asian man cooking"): only
  // the synonym adds anything.
  if (tokenize(subject).some((word) => GENERIC_PERSON_WORDS.has(word))) {
    return (synonym ? [withAction(`${synonym} ${subject}`)] : []).slice(0, count);
  }

  const activity = activityOf(subject);
  // A stated gender ("ballerina", "man") keeps only that person phrasing.
  const people = gender === "female" ? ["woman"] : gender === "male" ? ["man"] : ["woman", "man"];
  return [
    ...people.map((person) => `${descriptor} ${person} ${activity}`),
    ...(synonym ? [`${synonym} ${subject}`] : [])
  ].slice(0, count);
}

/** Puts the named background in front of the rest, the way people write it. */
export function withBackgroundFirst(query: string, background: string): string {
  const rest = query
    .split(" ")
    .filter((word) => !background.split(" ").includes(word.toLowerCase()))
    .join(" ");
  return `${titleCase(background)} ${rest}`.trim();
}

function stableHash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function pickByQuery<T>(query: string, options: readonly T[]): T {
  return options[stableHash(query.toLowerCase()) % options.length];
}


// --- Subject synonyms -----------------------------------------------------
// Museum catalogs describe some subjects in their own vocabulary: a work
// showing a face is catalogued as a "portrait" or "head", almost never
// "face". `museumTerm` is what the Met is searched with; `match` is what
// counts as showing the subject.
const SUBJECT_SYNONYMS: Record<string, { museumTerm?: string; match: string[] }> = {
  face: { museumTerm: "portrait", match: ["portrait", "portraits", "head", "heads", "bust", "profile"] },
  // "side profile" describes a face, not an object: in the Met's catalog a
  // bare "profile" search is mostly metal ornaments ("Profile Warrior").
  profile: { museumTerm: "portrait", match: ["portrait", "portraits", "head", "heads", "face", "faces"] },
  faces: { museumTerm: "portrait", match: ["portrait", "portraits", "head", "heads", "bust", "profile"] },
  person: { museumTerm: "figure", match: ["figure", "figures", "people", "man", "woman", "child"] },
  people: { museumTerm: "figures", match: ["figure", "figures", "person", "crowd", "group"] },
  cat: { match: ["kitten", "kittens", "feline"] },
  dog: { match: ["puppy", "puppies", "hound"] },
  bird: { match: ["birds"] }
};

export function subjectSynonyms(word: string): string[] {
  return SUBJECT_SYNONYMS[word]?.match ?? [];
}

export function museumSubjectTerm(subject: string): string {
  return SUBJECT_SYNONYMS[subject]?.museumTerm ?? subject;
}

// --- Settings -------------------------------------------------------------
// What counts as the stated setting being present (P6: "girl walking in the
// city" returned a girl in a flower field).
const SETTING_SYNONYMS: Record<string, string[]> = {
  city: ["street", "streets", "urban", "downtown", "sidewalk", "town", "avenue", "crosswalk", "alley", "skyline", "buildings"],
  street: ["city", "urban", "sidewalk", "road", "avenue", "crosswalk", "alley"],
  cafe: ["coffee", "coffeehouse", "restaurant", "bistro", "bar"],
  jungle: ["rainforest", "forest", "tropical"],
  forest: ["woods", "woodland", "trees"],
  beach: ["shore", "seaside", "coast", "sand", "ocean", "sea"],
  park: ["garden", "gardens"],
  field: ["meadow", "grass", "fields"],
  kitchen: ["cooking", "stove"]
};

export function settingMatchWords(setting: string): string[] {
  return tokenize(setting).flatMap((word) => [word, ...(SETTING_SYNONYMS[word] ?? [])]);
}

// --- Physical objects -----------------------------------------------------
// Museum search returns a lot of 3D objects (ornaments, sculpture, ceramics)
// whose titles happen to match -- "too many statues" for a lighting or pose
// query (P2: "a porcelain piece with no hands"). Classifications here are
// the Met's `classification` and AIC's `artwork_type_title`. ("Glass-Painted"
// is the Met's term for reverse glass paintings, which are flat; metalpoint
// is a drawing technique.)
const OBJECT_CLASSIFICATION_PATTERN =
  /sculpt|statu|ornament|ceramic|porcelain|pottery|terracott|metal(?!point)|bronzes|jewel|glass(?!-paint)|vessel|vase|furniture|arms|armor|helmet|sword|dagger|coin|medal|ivor|mask|enamel|gold and silver|textile|velvet|tapestr|embroider|lace/i;

// Typing any of these means objects are what the user wants, so the cap
// doesn't apply ("coffee cup" should still return the Met's porcelain cups).
const OBJECT_QUERY_WORDS = new Set([
  "statue", "statues", "sculpture", "sculptures", "figurine", "figurines",
  "bust", "busts", "carving", "carvings", "relief", "ceramic", "ceramics",
  "pottery", "porcelain", "vase", "vases", "vessel", "vessels", "bowl",
  "bowls", "cup", "cups", "mug", "mugs", "teapot", "plate", "plates", "jug",
  "armor", "armour", "helmet", "sword", "swords", "jewelry", "jewellery",
  "necklace", "ornament", "ornaments", "mask", "masks", "furniture", "chair",
  "coin", "coins", "medal", "object", "objects", "3d", "artifact",
  "artifacts", "glass", "bronze", "marble"
]);

// Words that ask for a sculpture or 3D work itself, not just name a thing.
const SCULPTURE_QUERY_WORDS = new Set([
  "statue", "statues", "sculpture", "sculptures", "figurine", "figurines",
  "bust", "busts", "carving", "carvings", "relief", "ceramic", "ceramics",
  "pottery", "porcelain", "object", "objects", "3d", "artifact", "artifacts",
  "bronze", "marble"
]);

/**
 * Whether 3D objects are wanted. For body-part subjects an object word
 * usually names what's held ("hands holding coffee cup"), not a request for
 * porcelain -- that search was filling museum slots with cups and marble
 * hands instead of paintings of people drinking coffee -- so there only a
 * sculpture or material word counts.
 */
// Only these phrases ask for black-and-white images; "Black" alone usually
// describes a person ("Black woman"), so it never counts.
const MONOCHROME_PHRASES = ["black and white", "black & white", "b&w", "monochrome", "grayscale", "greyscale", "noir"];

export function wantsMonochrome(query: string): boolean {
  const normalized = query.toLowerCase();
  return MONOCHROME_PHRASES.some((phrase) => normalized.includes(phrase));
}

export function queryAllowsObjects(tokens: string[], bodyPartSubject = false): boolean {
  const words = bodyPartSubject ? SCULPTURE_QUERY_WORDS : OBJECT_QUERY_WORDS;
  return tokens.some((token) => words.has(token));
}

export function isObjectResult(result: ArtworkResult): boolean {
  if (result.source === "Unsplash") return false;
  return Boolean(result.classification && OBJECT_CLASSIFICATION_PATTERN.test(result.classification));
}

// --- Near misses ----------------------------------------------------------
// Objects testers explicitly said were the wrong thing (P4: "coffee cup"
// returned mugs). Only applies when the result lacks the word they typed.
const NEAR_MISSES: Record<string, string[]> = {
  cup: ["mug", "mugs"],
  cups: ["mug", "mugs"],
  mug: ["teacup"],
  glass: ["mug"],
  horse: ["pony", "donkey"],
  cat: ["lion", "tiger"],
  dog: ["wolf", "fox"]
};

export function nearMissWords(token: string): string[] {
  return NEAR_MISSES[token] ?? [];
}

// --- Tokenizing & matching ------------------------------------------------

// Hyphens split words, so catalog titles like "Self-Portrait" or
// "Close-up of hands" match "portrait" and "hands".
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s-]+/)
    .map((token) => token.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);
}

export function contentTokens(text: string): string[] {
  return tokenize(text).filter((token) => token.length >= 2 && !FILLER_WORDS.has(token));
}

export function isFillerWord(token: string): boolean {
  return FILLER_WORDS.has(token);
}

export function isSettingPreposition(token: string): boolean {
  return SETTING_PREPOSITIONS.has(token);
}

export function canBeSubject(token: string): boolean {
  return !NON_SUBJECT_WORDS.has(token) && !lookupAction(token) && !token.endsWith("ing");
}

/**
 * Word-level match against a result's text. A singular query word also
 * accepts its plural ("hand" matches "hands"), but a plural query word only
 * gets a partial match from the singular form ("hands" vs a single "hand")
 * -- returned as 0.5 so callers can reward the exact form.
 */
export function wordMatchStrength(textWords: Set<string>, queryWord: string): number {
  if (textWords.has(queryWord)) return 1;

  if (textWords.has(`${queryWord}s`) || textWords.has(`${queryWord}es`)) return 1;

  if (queryWord.length > 3 && queryWord.endsWith("s")) {
    const singulars = [queryWord.slice(0, -1), queryWord.slice(0, -2)];
    if (singulars.some((singular) => textWords.has(singular))) return 0.5;
  }

  return 0;
}

export function hasAnyWord(textWords: Set<string>, words: string[]): boolean {
  return words.some((word) => wordMatchStrength(textWords, word) > 0);
}

/**
 * Everything we know about a result as plain text, for word matching.
 * Deliberately excludes AIC's long `description` -- it mentions incidental
 * things (a cat in the background of a 300-word essay) often enough to
 * make a result look relevant when it isn't.
 */
export function resultText(result: ArtworkResult): string {
  return withoutEffectPhrases([
    result.title,
    result.shortDescription,
    result.medium,
    result.classification,
    ...(result.tags ?? []),
    ...(result.subjectTitles ?? []),
    ...(result.styleTitles ?? []),
    ...(result.themeTitles ?? []),
    ...(result.techniqueTitles ?? [])
  ]
    .filter((bit): bit is string => Boolean(bit && bit.trim()))
    .join(" "));
}

// "motion blur" describes the camera, not movement in the scene, so it
// mustn't satisfy a request for "motion" -- otherwise a blurred photo
// outscores sharp ones on exactly the word that should exclude it.
// looksBlurry() still sees the original caption.
export function withoutEffectPhrases(text: string): string {
  return text.replace(/\bmotion blur(red)?\b/gi, "blur");
}

export function resultWords(result: ArtworkResult): Set<string> {
  return new Set(tokenize(resultText(result)));
}

// Caption text that says the photo is deliberately blurred. Real blur
// detection from pixels is planned with the contrast check; until then this
// catches the common case (P2: motion blur made the pose unreadable).
const BLUR_CAPTION_PATTERN = /\b(blur|blurry|blurred|blurring|out of focus|long exposure|unfocused)\b/i;
const BLUR_QUERY_WORDS = ["blur", "blurry", "blurred", "exposure", "unfocused"];

export function looksBlurry(result: ArtworkResult): boolean {
  return BLUR_CAPTION_PATTERN.test([result.title, result.shortDescription].filter(Boolean).join(" "));
}

export function queryWantsBlur(tokens: string[]): boolean {
  return tokens.some((token) => BLUR_QUERY_WORDS.includes(token));
}

export function containsPhrase(text: string, phrase: string): boolean {
  const pattern = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "i");
  return pattern.test(text);
}
