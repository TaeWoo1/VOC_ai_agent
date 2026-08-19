/**
 * **No migrated live CLI may go back to advancing on a file.**
 *
 * The per-CLI suites each prove their own migration. This one is the ratchet: it sweeps every live entrypoint in
 * `src/cli/` and fails when one that has been moved onto the trusted confirmation channel starts reading a
 * readiness sentinel again. Without it the next edit to any of nineteen files could quietly reopen the hole, and
 * the only thing that would notice is a live sitting.
 *
 * **Aborting is deliberately asymmetric.** A forged abort STOPS a run, which is the safe direction, so abort and
 * stop paths stay files and are excluded here by name. Only ADVANCING needs a channel a model cannot reach.
 *
 * The un-migrated list is written down rather than inferred, for two reasons: an inferred list would shrink
 * silently when someone deleted a CLI instead of fixing it, and `docs/sellerops_live_approval_contract.md` §5a
 * quotes this list to operators. It is a debt register, and it may only get shorter.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync , existsSync} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE_DIR = dirname(fileURLToPath(import.meta.url));
/**
 * R2 moved the calibration recorders and the one-off live-run harnesses out of `src/cli` into
 * `instruments/`. This fence is a COVERAGE fence: if it kept scanning only `src/cli` it would still be
 * green while silently covering ~45 fewer entrypoints. It scans every tree a live CLI can live in.
 */
const CLI_DIRS = [
  resolve(HERE_DIR, "../../src/cli"),
  resolve(HERE_DIR, "../../instruments/calibration"),
  resolve(HERE_DIR, "../../instruments/live-runs"),
];

/** The tree a given CLI actually lives in (src/cli, or the instruments trees R2 moved it to). */
function cliPath(file: string): string {
  for (const dir of CLI_DIRS) {
    const full = join(dir, file);
    if (existsSync(full)) return full;
  }
  throw new Error(`CLI not found in any tree: ${file}`);
}


/**
 * The CLIs that still take an operator ADVANCE from the filesystem. Each needs a surface that can carry more
 * than two answers (`confirmed` / `mismatch` / `rescan` / `stop` …), which the channel does not have yet.
 *
 * ⚠ This list may only ever shrink. Adding a name to it is adding a way for a model to advance a live run.
 */
const NOT_YET_MIGRATED: readonly string[] = [
  // The NAVER reply workstream: multi-answer checkpoints (confirmed / mismatch / rescan / stop).
  "run-guided-reply-session-live-naver.ts",
  "run-reply-submission-live-naver.ts",
  "run-review-id-reconciliation-live-naver.ts",
  "run-chrome-selector-discovery-live-naver.ts",
  "run-store-identity-diagnostic-live-naver.ts",
  "run-abort-rehearsal-live-naver.ts",
  "run-composer-abort-rehearsal-live-naver.ts",
  "calibrate-reply-target.ts",
  "calibrate-element-anchors.ts",
  // The Action Window runtime's own operator signal.
  "run-action-window-live-naver.ts",
  // The ESM capture/classify CLIs.
  "classify-esm-review.ts",
  "capture-esm-review.ts",
  "capture-esm-review-upload.ts",
  "probe-esm-session-ttl.ts",
  // The shared helper the migrated probes no longer import. It is inert (a path builder), and it goes when the
  // last CLI above stops needing the shape.
  "probe-sentinel.ts",
];

/** Files that are not CLI entrypoints, or that talk ABOUT the channel rather than using one. */
const NOT_A_LIVE_ENTRYPOINT: readonly string[] = [
  "operator-confirm.ts",
  "operator-confirm-host.ts",
  "operator-run-grant.ts",
  "live-run-approval.ts",
  "approval-manifest.ts",
  "approval-manifest-cli.ts",
];

/** Source with comments stripped: the doc blocks NAME the files they replaced, deliberately. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("//");
    })
    .join("\n");
}

/**
 * Does this file read a file to decide whether to ADVANCE?
 *
 * Abort/stop/skip-to-halt paths are excluded by the name of the path variable they test, because those are the
 * asymmetric direction: a forged abort stops a run.
 */
function readsAnAdvanceSentinel(src: string): boolean {
  for (const m of src.matchAll(/existsSync\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
    const name = m[1] ?? "";
    // The asymmetric direction stays a file, and every CLI still clears one at startup.
    if (/abort|stop/i.test(name)) continue;
    // Named for what it stands for, rather than for being a path: `readyPath`, `donePath`, `skipPath`,
    // `NEXT_SIGNAL`. A bare `path` is the removal helper's parameter and an ordinary file check, and matching
    // it flagged every CLI that clears its own abort file.
    if (/(sentinel|ready|signal|done|pressed|skip)/i.test(name)) return true;
  }
  // The generic waits, and the shape the reply-workstream runners use: a poller taking the path as a plain
  // parameter, so the deciding `existsSync` never sees the sentinel's own name.
  return (
    /waitForSentinel\s*\(/.test(src) ||
    /sentinelPathFor\s*\(/.test(src) ||
    /waitForFile\s*\(\s*[A-Za-z_$][\w$]*(?:Sentinel|Ready|Signal)\b/.test(src) ||
    /\bresolve\([^)]*,\s*"[a-z0-9-]+\.ready"\)/i.test(src) ||
    /\.ready"\s*;?\s*$/m.test(src)
  );
}

const FILES = CLI_DIRS.flatMap((dir) => readdirSync(dir))
  .filter((f) => f.endsWith(".ts"))
  .filter((f) => !NOT_A_LIVE_ENTRYPOINT.includes(f));

describe("the operator-advance channel is a ratchet", () => {
  it("**every CLI outside the debt register advances on a press, never on a file**", () => {
    const regressed = FILES.filter((f) => !NOT_YET_MIGRATED.includes(f)).filter((f) =>
      readsAnAdvanceSentinel(code(cliPath(f))),
    );
    expect(regressed, `these CLIs read an advance sentinel again: ${regressed.join(", ")}`).toEqual([]);
  });

  it("**the debt register is honest** — every name on it really does still read one", () => {
    // A register that keeps names it has outgrown is a register nobody trusts. When a CLI is migrated, its name
    // comes off this list in the same change, and §5a of the approval contract is updated with it.
    const stale = NOT_YET_MIGRATED.filter(
      (f) => FILES.includes(f) && !readsAnAdvanceSentinel(code(cliPath(f))),
    );
    expect(stale, `these are migrated and should be removed from NOT_YET_MIGRATED: ${stale.join(", ")}`).toEqual([]);
  });

  it("every name on the register is a file that exists", () => {
    const missing = NOT_YET_MIGRATED.filter((f) => !FILES.includes(f));
    expect(missing, `deleted or renamed: ${missing.join(", ")}`).toEqual([]);
  });

  it("the guard can actually SEE a regression — the detector is exercised on a known shape", () => {
    // A guard whose detector silently matches nothing is worse than no guard. This is the exact shape the
    // migrated CLIs used to have.
    expect(readsAnAdvanceSentinel('const ready = await waitForSentinel(sentinelPath, T, I);')).toBe(true);
    expect(readsAnAdvanceSentinel('if (existsSync(readyPath)) return "ready";')).toBe(true);
    expect(readsAnAdvanceSentinel('const p = sentinelPathFor(cfg.statusFile);')).toBe(true);
    // The reply-workstream shape: the deciding check never sees the sentinel's own name.
    expect(readsAnAdvanceSentinel('const readySentinel = resolve(statusDir, "guided-ready.ready");')).toBe(true);
    expect(readsAnAdvanceSentinel("if (!(await waitForFile(readySentinel, T))) return;")).toBe(true);
    // …and that it does NOT fire on the abort direction, which is deliberately still a file.
    expect(readsAnAdvanceSentinel('if (abortFlag.v || existsSync(abortPath)) return "abort";')).toBe(false);
    expect(readsAnAdvanceSentinel('if (existsSync(stopSentinel)) return "stop";')).toBe(false);
    // …nor on the removal helper every CLI keeps for its abort file, nor on an ordinary file check.
    expect(readsAnAdvanceSentinel("if (existsSync(path)) unlinkSync(path);")).toBe(false);
    expect(readsAnAdvanceSentinel("if (!existsSync(artifactDir)) return 0;")).toBe(false);
  });
});

describe("the migrated CLIs reach the channel through the shared host", () => {
  const MIGRATED = FILES.filter((f) => !NOT_YET_MIGRATED.includes(f)).filter((f) =>
    code(cliPath(f)).includes("attachOperatorConfirmTab("),
  );

  it("there are enough of them that this file is measuring something", () => {
    // A sanity floor: if the sweep found two, the assertions below would pass vacuously while the migration
    // silently rotted. Fourteen CLIs were migrated in the unit that added this.
    expect(MIGRATED.length).toBeGreaterThanOrEqual(12);
  });

  it("**every one of them actually WAITS on a confirmation**", () => {
    // The assertions below are all negatives, and negatives cannot see the regression that matters most:
    // delete every `confirmHost.confirm(...)` while keeping the `attachOperatorConfirmTab(...)` call and this
    // file would stay green with every checkpoint gone. "No sentinel" is not "advances on a press".
    for (const f of MIGRATED) {
      const src = code(cliPath(f));
      expect(src, `${f} attaches a confirmation surface but never waits on it`).toMatch(
        // …by any of the shapes that reach `host.confirm` — a checkpoint, a run grant, or an action barrier.
        /confirmHost\.confirm\(|confirm\(ask\)|confirmCheckpoint\(|confirmRunGrant\(|confirmActionBarrier\(/,
      );
    }
  });

  it("**a refused confirmation returns** — no migrated CLI reads on past one", () => {
    // Each CLI's own suite pins WHAT it must not do after a refusal; this pins that a refusal is handled at
    // all. `observe-api-center` printed a line and carried on into the read for one commit.
    for (const f of MIGRATED) {
      const src = code(cliPath(f));
      if (!/confirmation\.signal !== "ready"/.test(src)) continue;
      for (const m of src.matchAll(/confirmation\.signal !== "ready"\)\s*\{?([\s\S]{0,400})/g)) {
        // `break` counts: the WING recorder's checkpoint loop leaves before its reading rather than returning
        // from `main`. What does NOT count is falling through, which is what this exists to catch.
        expect(m[1] ?? "", `${f}: a refusal branch that does not return, throw or break`).toMatch(
          /\breturn\b|\bthrow\b|\bbreak\b/,
        );
      }
    }
  });

  it("**none of them builds its own arm script or mints its own token**", () => {
    // One implementation of the trusted-press gate. A second copy is a second thing to get wrong, in a file
    // that also prints to a terminal.
    for (const f of MIGRATED) {
      const src = code(cliPath(f));
      expect(src, f).not.toContain("buildOperatorConfirmArmScript");
      expect(src, f).not.toContain("mintOperatorConfirmToken");
      expect(src, f).not.toContain("OPERATOR_CONFIRM_STATE_KEY");
    }
  });

  it("**none of them hands a driver the raw context** — the confirmation tab must stay unmeasured", () => {
    // `activePage()` takes the NEWEST tab, so an unfiltered context resolves to the blank SellerOps surface the
    // moment it opens: measurements land there, screenshots are taken of it, and the reading reads as confident.
    for (const f of MIGRATED) {
      const src = code(cliPath(f));
      if (!src.includes("context:")) continue;
      expect(src, f).not.toMatch(/context:\s*ctx\b/);
      expect(src, f).not.toMatch(/ctx\.pages\(\)\[\s*ctx\.pages\(\)\.length/);
    }
  });
});
