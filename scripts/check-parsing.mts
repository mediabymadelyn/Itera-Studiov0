/**
 * Checks how tricky searches are parsed: the subject, the named background
 * (if any) and the photo searches built from them. Rule-based parse only
 * (no AI rewrite), so it's free and repeatable. Add a case whenever a
 * search is misread.
 *
 *   npm run check:parsing
 */
import { planQuery } from "../lib/search/queryPlan";

type Case = { query: string; subject: string; background: string | null; monochrome?: boolean; appearance?: string[] };

const CASES: Case[] = [
  // A background phrase is a description of the person, not the subject.
  { query: "african american dancer", subject: "dancer", background: "african american" },
  { query: "black dancer mid motion", subject: "dancer", background: "black" },
  { query: "black ballerina", subject: "ballerina", background: "black" },
  { query: "south asian man cooking", subject: "man", background: "south asian" },
  { query: "native american woman portrait", subject: "woman portrait", background: "native american" },
  // Color words before things, not people, are colors.
  { query: "woman in a black dress dancing", subject: "woman", background: null, appearance: ["black dress"] },
  { query: "old man with white beard", subject: "man", background: null, appearance: ["white beard"] },
  { query: "white horse running", subject: "horse", background: null },
  { query: "black and white portrait of a woman", subject: "portrait", background: null, monochrome: true },
  // Appearance stays one phrase, attached to the person.
  { query: "purple hair girl", subject: "girl", background: null, appearance: ["purple hair"] },
  { query: "girl with long curly hair", subject: "girl", background: null, appearance: ["long curly hair"] },
  { query: "woman in a red dress dancing", subject: "woman", background: null, appearance: ["red dress"] },
  { query: "man with a beard reading", subject: "man", background: null, appearance: ["beard"] },
  { query: "black woman with braids", subject: "woman", background: "black", appearance: ["braids"] },
  // Earlier misreads.
  { query: "hands holding coffee cup", subject: "hands", background: null },
  { query: "oil painting portrait", subject: "portrait", background: null },
  { query: "dramatic lighting on face", subject: "face", background: null }
];

let failures = 0;
for (const testCase of CASES) {
  const plan = await planQuery(testCase.query, { allowLlmRewrite: false });
  const problems = [
    plan.subject !== testCase.subject && `subject "${plan.subject}" (expected "${testCase.subject}")`,
    plan.statedBackground !== testCase.background &&
      `background ${JSON.stringify(plan.statedBackground)} (expected ${JSON.stringify(testCase.background)})`,
    testCase.monochrome !== undefined && plan.wantsMonochrome !== testCase.monochrome &&
      `black-and-white request ${plan.wantsMonochrome} (expected ${testCase.monochrome})`,
    testCase.appearance !== undefined && plan.appearance.join(", ") !== testCase.appearance.join(", ") &&
      `appearance [${plan.appearance.join(", ")}] (expected [${testCase.appearance.join(", ")}])`
  ].filter(Boolean);

  if (problems.length > 0) failures++;
  console.log(`${problems.length ? "FAIL" : "ok  "}  "${testCase.query}" -> ${problems.length ? problems.join("; ") : `subject "${plan.subject}"`}`);
  console.log(`        photos: "${plan.photoQuery}"${plan.photoBackgroundQueries.length ? ` + ${plan.photoBackgroundQueries.map((q) => `"${q}"`).join(", ")}` : ""}`);
}

console.log(`\n${CASES.length - failures}/${CASES.length} parsed as expected.`);
if (failures > 0) process.exit(1);
