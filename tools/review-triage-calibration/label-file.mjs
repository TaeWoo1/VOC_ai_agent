/**
 * Reading a labeler's file, validated against the closed vocabularies of RUBRIC v2 §2, §3 and §5.
 *
 * Shared by `derive-labels.mjs` and `derive-pilot.mjs` because both write a committed artifact from
 * the same worksheet output, and two copies of this that drifted would mean one file admitting a
 * value the other refused — with the difference visible only after a human had spent the time.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MAX_TAGS, REASON_CODE_SET, TAG_SET, TIER_CODES } from "./vocabulary.mjs";

/** The only fields a worksheet may hand over. Anything else is a refusal, never a silent drop. */
export const ALLOWED_FIELDS = new Set(["key", "tier", "reasonCode", "tags"]);

/**
 * @param rows     the local `rows.json`, so a key that was never drawn is caught here rather than
 *                 becoming a label against a review nobody sampled
 * @param problems accumulates; the caller decides whether to refuse, so every problem in a file is
 *                 reported at once instead of one per run
 * @returns Map of key → `{ tier, reasonCode?, tags? }`
 */
export function readLabelFile(path, label, rows, problems) {
  const map = new Map();
  if (!path) {
    return map;
  }
  const entries = JSON.parse(readFileSync(resolve(path), "utf8")).labels ?? [];
  for (const [index, entry] of entries.entries()) {
    const at = `${label} entry ${index + 1}`;
    for (const field of Object.keys(entry)) {
      if (!ALLOWED_FIELDS.has(field)) problems.push(`${at}: field "${field}" is not in the schema`);
    }
    if (!rows[entry.key]) {
      problems.push(`${at}: key "${entry.key}" is not a drawn row`);
      continue;
    }
    if (map.has(entry.key)) problems.push(`${at}: duplicate key "${entry.key}"`);
    if (!TIER_CODES.has(entry.tier)) {
      problems.push(`${at}: tier "${entry.tier}" is not one of the four`);
      continue;
    }
    const tags = entry.tags ?? [];
    if (!Array.isArray(tags) || tags.length > MAX_TAGS || tags.some((t) => !TAG_SET.has(t))) {
      problems.push(`${at}: tags must be at most ${MAX_TAGS} values from the stored vocabulary`);
    }
    if (new Set(tags).size !== tags.length) problems.push(`${at}: repeated tag`);
    if (entry.tier === "UNCERTAIN") {
      // UNCERTAIN is excluded from every metric (v1 §4). Carrying a reason or a tag beside it would
      // invite someone to count it later.
      if (entry.reasonCode || tags.length > 0) problems.push(`${at}: UNCERTAIN carries no reason and no tag`);
      map.set(entry.key, { tier: "UNCERTAIN" });
      continue;
    }
    if (!REASON_CODE_SET.has(entry.reasonCode)) {
      problems.push(`${at}: reasonCode "${entry.reasonCode}" is not one of the thirteen`);
      continue;
    }
    map.set(entry.key, { tier: entry.tier, reasonCode: entry.reasonCode, tags });
  }
  return map;
}
