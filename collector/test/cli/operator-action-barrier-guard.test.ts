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
  { call: "continueAtCardOnce(", why: "one real click on the seller's NAVER page" },
  { call: "resolveReconnectIfNeeded(", why: "may reach the guarded continue click" },
  { call: "captureAndUpload(", why: "export click → download → upload → status write" },
  { call: "runExport(", why: "triggers the marketplace export and captures the file" },
  { call: "uploadReviewFile(", why: "the seller's data leaves this machine" },
];

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
        // `import { runExport }` is not a call site, and a CLI may name one in a refusal message.
        if (!new RegExp(`(await |= )${call.replace("(", "\\(")}`).test(src)) continue;
        if (!src.includes("confirmActionBarrier(")) offenders.push(`${f} → ${call} (${why})`);
      }
    }
    expect(offenders, `these act without a press in front:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("**the press comes BEFORE the act**, not after it", () => {
    // Read inside `main()` only. A helper defined ABOVE main contains the acting call at a lower file offset
    // while being CALLED from below the barrier — comparing raw file positions failed on exactly that, and a
    // guard that reports a correct file as broken is a guard people learn to edit rather than to trust.
    for (const f of FILES) {
      const src = code(join(CLI_DIR, f));
      if (!src.includes("confirmActionBarrier(")) continue;
      const mainAt = src.search(/async function main\(/);
      const body = mainAt < 0 ? src : src.slice(mainAt);
      const firstBarrier = body.indexOf("confirmActionBarrier(");
      if (firstBarrier < 0) continue; // the barrier lives in a helper this file calls; the sweep above covers it
      for (const { call } of ACTING_CALLS) {
        const at = body.search(new RegExp(`(await |= )${call.replace("(", "\\(")}`));
        if (at < 0) continue;
        expect(at, `${f}: ${call} happens before any barrier is confirmed`).toBeGreaterThan(firstBarrier);
      }
    }
  });

  it("**a refused barrier stops the run** — it is never a warning the code walks past", () => {
    for (const f of FILES) {
      const src = code(join(CLI_DIR, f));
      if (!src.includes("confirmActionBarrier(")) continue;
      for (const m of src.matchAll(/if \(!allowed\w*\) \{([\s\S]{0,500})/g)) {
        expect(m[1] ?? "", `${f}: a refused barrier that does not return or throw`).toMatch(/\breturn\b|\bthrow\b/);
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
