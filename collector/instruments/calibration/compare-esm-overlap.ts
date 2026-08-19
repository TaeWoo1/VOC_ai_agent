/**
 * OFFLINE ESM+ REVIEW — Gate 5 / Slice 5A two-export OVERLAP comparison.
 *
 *   npm run compare-esm-overlap -- --a /abs/esm-overlap-A.json --b /abs/esm-overlap-B.json
 *
 * Strictly offline + read-only: it reads two ALREADY-SANITIZED capture summaries (each the stdout
 * JSON of a `capture-esm-review --emit-composite-key` run, saved by the operator), pulls their
 * `compositeKeys` sets, and prints a sanitized overlap verdict via the pure `summarizeOverlap`. It
 * launches NO browser, performs NO click / download / upload / API / DB / status write, and runs
 * NO scheduler. It reads no raw review data — the inputs contain only salted hashes / buckets /
 * booleans, so nothing raw can pass through.
 *
 * SANITISED OUTPUT ONLY. Slice 5A/5B strengthen the composite-key direction; they CONFIRM nothing
 * (dedupKeyConfirmed / schemaMappingConfirmed stay false; dedup stays NEEDS_VERIFICATION). No file
 * path is echoed even on the error path.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { summarizeOverlap } from "../../src/esm/esm-review-overlap";
import type { SanitizedCompositeKeySet } from "../../src/esm/esm-review-composite-key";
import { log } from "../../src/log";

/** Pure: read `--<name> <path>` (or `=path`) from argv. Null when absent. */
export function parseNamedPathArg(args: readonly string[], flag: string): string | null {
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === flag) return args[i + 1] ?? null;
    if (a.startsWith(`${flag}=`)) return a.slice(flag.length + 1);
  }
  return null;
}

/** Read a saved capture summary and return its `compositeKeys` set, or null when absent/unreadable. */
function loadCompositeKeys(path: string): SanitizedCompositeKeySet | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const keys = (parsed as { compositeKeys?: unknown }).compositeKeys;
  if (typeof keys !== "object" || keys === null) return null;
  if (!Array.isArray((keys as { rows?: unknown }).rows)) return null;
  return keys as SanitizedCompositeKeySet;
}

function main(): void {
  const args = process.argv.slice(2);
  const pathA = parseNamedPathArg(args, "--a");
  const pathB = parseNamedPathArg(args, "--b");
  if (pathA === null || pathA.trim().length === 0 || pathB === null || pathB.trim().length === 0) {
    console.error("Slice 5A overlap needs two saved capture summaries: --a <path> --b <path>.");
    process.exit(4);
    return;
  }

  const a = loadCompositeKeys(pathA);
  const b = loadCompositeKeys(pathB);
  if (a === null || b === null) {
    // No path echoed; report only WHICH side lacked a composite-key set (capture without --emit-composite-key).
    console.error(
      "Could not read a composite-key set from one or both inputs " +
        `(A:${a === null ? "missing" : "ok"}, B:${b === null ? "missing" : "ok"}). ` +
        "Re-run capture with --emit-composite-key and save its stdout JSON.",
    );
    process.exit(5);
    return;
  }

  const verdict = summarizeOverlap(a, b);
  console.log(JSON.stringify({ mode: "overlap", ...verdict }, null, 2));
  log("esm.review.overlap", {
    comparable: verdict.comparable,
    channelMatch: verdict.channelMatch,
    slotProvenanceMatch: verdict.slotProvenanceMatch,
    l1Overlap: verdict.l1.overlapBucket,
    l1MatchRate: verdict.l1.matchRate,
    l2FalseMerge: verdict.l2.falseMergeBucket,
    l3FalseMerge: verdict.l3.falseMergeBucket,
    riskCount: verdict.risks.length,
  });
}

// Run only as a script entrypoint — importing a helper (e.g. `parseNamedPathArg`) must not execute it.
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
