/**
 * Transition verifier (R1). After REQUEST_STEP_RECHECK, inspect the fixture for the EXACT expected
 * post-action state and confirm the target signature is unchanged. Returns a sanitized result only.
 * This is the sole authority for step completion — a click without a verified transition never
 * completes the step.
 */
import type { Page } from "playwright";
import { IN_PAGE_SIG_FACTORY, STATE_DONE } from "./signature";
import type { VerifyResult } from "./engine";

export async function verifyTransition(page: Page, opts: { expectedSig: string }): Promise<VerifyResult> {
  return page.evaluate(
    (args): { verified: boolean; drift: boolean } => {
      const sig = new Function("return " + args.factorySrc)() as (r: string, l: string) => string;
      const els = Array.from(document.querySelectorAll("[data-aw-target]"));
      // Missing or ambiguous target after highlight → treat as drift (fail closed).
      if (els.length !== 1) return { verified: false, drift: true };
      const el = els[0]!;
      const currentSig = sig(el.getAttribute("data-aw-role") ?? "", el.getAttribute("data-aw-label") ?? "");
      if (currentSig !== args.expectedSig) return { verified: false, drift: true };
      const done = document.body.getAttribute("data-aw-state") === args.stateDone;
      return { verified: done, drift: false };
    },
    { factorySrc: IN_PAGE_SIG_FACTORY, expectedSig: opts.expectedSig, stateDone: STATE_DONE },
  );
}
