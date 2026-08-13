/**
 * **Auto-read may advance guidance. It may not reach an act.**
 *
 * `operator-advance-channel-guard` proves no live CLI advances a CHECKPOINT on a file. It cannot see this: a
 * run that polls the page itself, decides the page looks ready, and clicks — no sentinel, no chat text, and no
 * person. The reading is real; the inference from it is not the seller's.
 *
 * So this sweeps for the ACTS (`docs/sellerops_live_approval_contract.md` §5b) and requires a verified press in
 * front of each one. It deliberately does NOT require one in front of a read: a confirmation the operator
 * presses forty times is one they stop reading, and that would cost more than it buys.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACTION_BARRIER_KINDS,
  ACTION_BARRIER_BUTTON_LABEL,
  actionBarrierAsk,
  actionBarrierRefusedMessage,
  confirmActionBarrier,
  OBSERVED_BY_AUTO_READ,
} from "../../src/cli/operator-action-barrier";
import { OPERATOR_UI_CONFIRMED, type OperatorConfirmAsk, type OperatorConfirmation } from "../../src/cli/operator-confirm";

const CLI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/cli");

/**
 * The calls that ACT, and the file each is expected to be reached from. A name here is a promise that a press
 * stands in front of it; adding one without wiring a barrier fails the sweep below.
 */
const ACTING_CALLS: readonly { readonly call: string; readonly why: string }[] = [
  // The PRIMITIVES first. A named-helper allowlist is only ever as complete as the last person to extend it,
  // and this list missed two CLIs that click, download and ingest into the database — the sweep passed them
  // cleanly. What cannot be missed is the act itself.
  { call: ".click(", why: "a real click on the seller's page" },
  { call: ".press(", why: "a real keypress on the seller's page" },
  { call: ".fill(", why: "typing into the seller's page" },
  { call: ".type(", why: "typing into the seller's page" },
  { call: ".selectOption(", why: "changing a control on the seller's page" },
  { call: ".check(", why: "ticking a control on the seller's page" },
  { call: ".setInputFiles(", why: "handing a file to the seller's page" },
  { call: 'waitForEvent("download")', why: "a file lands on this machine" },
  { call: ".saveAs(", why: "a file is written to disk" },
  // …and the named chains, which are what a reader recognises.
  { call: "continueAtCardOnce(", why: "one real click on the seller's NAVER page" },
  { call: "resolveReconnectIfNeeded(", why: "may reach the guarded continue click" },
  { call: "captureAndUpload(", why: "export click → download → upload → status write" },
  { call: "runExport(", why: "triggers the marketplace export and captures the file" },
  { call: "uploadReviewFile(", why: "the seller's data leaves this machine" },
  { call: "saveValidateUploadDeleteEsmReview(", why: "saves, uploads and ingests the seller's reviews" },
  { call: "diagnoseExportClickOnce(", why: "one real click on the export control" },
  { call: "confirmReviewUsageOnce(", why: "one real click on the consent modal" },
  { call: "confirmReviewUsageByIndexOnce(", why: "one real click on the consent modal, by index" },
];

/** Escape a call fragment for use inside a RegExp — several carry `(` and `"`. */
function escapeForRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The top-level function a source offset sits inside, with its body — for the ordering check. */
function enclosingFunction(src: string, at: number): { name: string; start: number; body: string } | null {
  const decl = /^(?:export )?(?:async )?function ([\w$]+)\(|^(?:export )?const ([\w$]+) = (?:async )?\(/gm;
  let found: { name: string; start: number } | null = null;
  for (const m of src.matchAll(decl)) {
    const i = m.index ?? 0;
    if (i > at) break;
    found = { name: (m[1] ?? m[2])!, start: i };
  }
  if (found === null) return null;
  const body = braceBlockAt(src, found.start);
  return body === null ? null : { ...found, body };
}

/** The `( … )` argument group starting at or after `from`, matched by parens. Null when there is none. */
function parenGroupAt(src: string, from: number): string | null {
  const open = src.indexOf("(", from);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth += 1;
    else if (src[i] === ")") {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

/** The `{ … }` block starting at or after `from`, matched by braces. Null when there is none. */
function braceBlockAt(src: string, from: number): string | null {
  const open = src.indexOf("{", from);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

/** Source with comments stripped: the doc blocks name these calls deliberately. */
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
 * CLIs that never READ a page, so there is no auto-read to stop. `upload-file` takes an absolute path the
 * operator typed and uploads that file: the naming of the file IS the person's decision, and there is no page,
 * no observation and nothing for a reading to be mistaken for an approval. The policy governs auto-read
 * reaching an act; it does not require a second confirmation of a command whose whole content was the act.
 */
const NO_PAGE_TO_READ: readonly string[] = ["upload-file.ts"];

const FILES = readdirSync(CLI_DIR)
  .filter((f) => f.endsWith(".ts"))
  .filter((f) => !NO_PAGE_TO_READ.includes(f));

describe("every act in a live CLI has a press in front of it", () => {
  it("**a CLI that reaches an acting call also confirms an action barrier**", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = code(join(CLI_DIR, f));
      // The boundary modules DEFINE these calls; the CLIs are what reach them.
      if (f === "operator-action-barrier.ts") continue;
      for (const { call, why } of ACTING_CALLS) {
        if (!src.includes(call)) continue;
        // `import { runExport }` is not a call site, and a CLI may name one in a refusal message. The shape
        // check is deliberately loose — `void f(…)`, `Promise.all([f(…)])` and `.then(() => f(…))` are all
        // calls, and an allowlist of call SHAPES is the same mistake as an allowlist of names.
        if (!new RegExp(`[^\\w.]${escapeForRegExp(call)}`).test(src)) continue;
        if (!src.includes("confirmActionBarrier(")) offenders.push(`${f} → ${call} (${why})`);
      }
    }
    expect(offenders, `these act without a press in front:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("**the press comes BEFORE the act**, not after it", () => {
    // Control flow, approximately, and honestly: for each acting call, find the top-level function it sits in.
    // Either that function confirms a barrier before the call, or every call site of that function must itself
    // come after one.
    //
    // The predecessor sliced the file at `async function main(` and gave up when the slice held no barrier —
    // which silently skipped `discover-export.ts` entirely, the one file where main() is at the bottom and both
    // the barrier and the acts live in helpers above it. A check that skips the hardest case is not a check.
    for (const f of FILES) {
      const src = code(join(CLI_DIR, f));
      if (!src.includes("confirmActionBarrier(")) continue;
      for (const { call } of ACTING_CALLS) {
        for (const m of src.matchAll(new RegExp(`[^\\w.]${escapeForRegExp(call)}`, "g"))) {
          const at = m.index ?? 0;
          // The barrier may be handed INTO the acting call as a callback — which is where it belongs when only
          // the boundary knows the act is genuinely next (`continueAtCardOnce` asks after every gate has
          // passed, so the operator is never asked over a login form). Recognised by rule rather than passing
          // by accident: without this branch the positional check below happened to be satisfied by an
          // unrelated earlier occurrence.
          const args = parenGroupAt(src, at);
          if (args !== null && args.includes("confirmActionBarrier(")) continue;
          const fn = enclosingFunction(src, at);
          if (fn === null) continue; // top-level module code, not a run path
          const barrierInFn = fn.body.indexOf("confirmActionBarrier(");
          if (barrierInFn >= 0 && barrierInFn < at - fn.start) continue;
          // Otherwise every call site of this helper must be preceded by a barrier.
          const sites = [...src.matchAll(new RegExp(`[^\\w.]${escapeForRegExp(fn.name)}\\(`, "g"))]
            .map((c) => c.index ?? 0)
            .filter((i) => i < fn.start || i > fn.start + fn.body.length);
          expect(sites.length, `${f}: ${call} sits in ${fn.name}, which nothing calls`).toBeGreaterThan(0);
          for (const site of sites) {
            const before = src.slice(0, site);
            expect(
              before.includes("confirmActionBarrier("),
              `${f}: ${fn.name} reaches ${call} but is called before any barrier is confirmed`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it("**a refused barrier stops the run** — it is never a warning the code walks past", () => {
    // The block's OWN exit, matched by braces. The predecessor searched the next 500 characters for the word
    // `return`, which the statement AFTER the block satisfied — deleting the refusal's own `return` left the
    // test green while a refused run fell straight through to the full capture leg.
    for (const f of FILES) {
      const src = code(join(CLI_DIR, f));
      if (!src.includes("confirmActionBarrier(")) continue;
      // Whatever the refusal was assigned to, not a fixed `allowed` prefix.
      for (const assign of src.matchAll(/(?:const|let)\s+([\w$]+)\s*=\s*await confirmActionBarrier\(/g)) {
        const name = assign[1]!;
        const guardAt = src.indexOf(`if (!${name})`, assign.index ?? 0);
        expect(guardAt, `${f}: nothing checks the result of confirmActionBarrier`).toBeGreaterThan(-1);
        const block = braceBlockAt(src, guardAt);
        expect(block, `${f}: the refusal guard has no block`).not.toBeNull();
        expect(block!, `${f}: the refusal block does not return or throw on its own`).toMatch(
          /\breturn\b|\bthrow\b|process\.exit\(/,
        );
      }
    }
  });

  it("**every refusal reports the same way** — a silent refusal reads as a crash", () => {
    // Four CLIs each inventing their own refusal shape is four things a harness has to know, and one that
    // printed nothing at all could not be told from a process that died before its first write.
    for (const f of FILES) {
      const src = code(join(CLI_DIR, f));
      if (!src.includes("confirmActionBarrier(")) continue;
      const refusals = (src.match(/actionBarrierRefusedMessage\(/g) ?? []).length;
      const records = (src.match(/barrierRefusedRecord\(/g) ?? []).length;
      expect(records, `${f}: ${refusals} refusal message(s) but ${records} machine-readable record(s)`).toBe(refusals);
    }
  });

  it("**a refusal writes no status file** — no CollectorState describes 'nothing happened'", () => {
    for (const f of FILES) {
      const src = code(join(CLI_DIR, f));
      if (!src.includes("confirmActionBarrier(")) continue;
      for (const m of src.matchAll(/barrierRefusedRecord\([\s\S]{0,400}/g)) {
        expect(m[0], `${f}: a refusal wrote a status file`).not.toContain("writeStatus(");
      }
    }
  });

  it("**`discover-reply-target` is left alone** — it crosses no barrier, so it asks for nothing", () => {
    // The policy's other half. It reads a row census and does nothing else; a confirmation here would be the
    // prompt-on-every-read that teaches operators to press without looking.
    const src = code(join(CLI_DIR, "discover-reply-target.ts"));
    expect(src).not.toContain("confirmActionBarrier(");
    for (const forbidden of [".click(", ".fill(", "runExport", "uploadReviewFile", "writeStatus"]) {
      expect(src, `discover-reply-target reached ${forbidden}, so it now needs a barrier`).not.toContain(forbidden);
    }
  });
});

describe("the two provenances cannot be mistaken for each other", () => {
  it("**an observation is not an approval**, and they are different strings", () => {
    expect(OBSERVED_BY_AUTO_READ).toBe("AUTO_READ");
    expect(OBSERVED_BY_AUTO_READ).not.toBe(OPERATOR_UI_CONFIRMED as string);
  });

  it("no CLI records an auto-read as the thing that approved something", () => {
    for (const f of FILES) {
      const src = code(join(CLI_DIR, f));
      for (const m of src.matchAll(/(provenance|approvedBy|confirmedBy)\s*:\s*([^,\n]+)/g)) {
        expect(m[2] ?? "", `${f}: an auto-read recorded as an approval`).not.toContain("AUTO_READ");
      }
    }
  });
});

describe("the barrier's ask tells the operator what one press buys", () => {
  const SPEC = {
    kind: "EXPORT_TRIGGER",
    title: "리뷰 내보내기",
    headline: "지금 화면의 내보내기 컨트롤을 눌러도 될까요?",
    allows: ["컨트롤을 한 번 누릅니다.", "파일 하나를 저장합니다.", "백엔드로 업로드합니다."],
    stillWillNot: "다른 컨트롤을 누르지 않습니다.",
  } as const;

  it("**the whole chain is on the screen** — one press for a disclosed chain, never a hidden one", () => {
    const all = actionBarrierAsk(SPEC).lines.join("\n");
    for (const a of SPEC.allows) expect(all).toContain(a);
    expect(all).toContain(SPEC.stillWillNot);
    expect(all).toContain("누르지 않으시면 아무것도 실행되지 않고");
  });

  it("the button is named for allowing an ACT, not for confirming a screen", () => {
    expect(actionBarrierAsk(SPEC).confirmLabel).toBe(ACTION_BARRIER_BUTTON_LABEL);
    expect(ACTION_BARRIER_BUTTON_LABEL).not.toBe("현재 화면 확인");
  });

  it("every kind has a refusal message, and it names the kind and nothing else", () => {
    for (const kind of ACTION_BARRIER_KINDS) {
      const msg = actionBarrierRefusedMessage(kind);
      expect(msg).toContain(kind);
      expect(msg).toContain("아무것도 실행되지 않았습니다");
    }
  });
});

describe("confirmActionBarrier decides on the press and nothing else", () => {
  const host = (answer: OperatorConfirmation): { announce(a: OperatorConfirmAsk): void; confirm(): Promise<OperatorConfirmation> } => ({
    announce: () => undefined,
    confirm: async () => answer,
  });
  const SPEC = { kind: "MARKETPLACE_CLICK", title: "t", headline: "h", allows: ["a"], stillWillNot: "n" } as const;

  it("a verified press allows the act", async () => {
    expect(await confirmActionBarrier(host({ signal: "ready", provenance: OPERATOR_UI_CONFIRMED, choice: "primary" }), SPEC)).toBe(true);
  });

  it("**a timeout and an abort both refuse** — a caller cannot get them the wrong way round", async () => {
    expect(await confirmActionBarrier(host({ signal: "timeout", provenance: null }), SPEC)).toBe(false);
    expect(await confirmActionBarrier(host({ signal: "abort", provenance: null }), SPEC)).toBe(false);
  });
});
