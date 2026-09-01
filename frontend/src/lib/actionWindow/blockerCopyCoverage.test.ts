/**
 * <b>Every blocker the runtime can raise has seller-facing words of its own.</b>
 * — NAVER Guided Acquisition Runtime Closure v2, blocker 3.
 *
 * On 2026-09-02 a guided import died of a driver fault (`RUNTIME_FAULT`) and the conversation card rendered
 * `COPY_FALLBACK` — 「안내를 준비하고 있어요」 — over a run that had been dead for minutes. Two separate holes
 * produced that one sentence: the card looked the code up through `resolveCopy`, whose fallback describes a run
 * that is *starting*, and `RUNTIME_FAULT` had no entry in the blocker table at all.
 *
 * The card now reads `blockerView`, whose fallback is at least honest. This test closes the other half: a code
 * may not rely on that fallback. It is deliberately driven from the CONTRACT's own list, so a code added to
 * `BLOCKER_CODES` fails here until someone writes the sentence a seller will read.
 */
import { describe, expect, it } from "vitest";
import { BLOCKER_CODES } from "../../../../contracts/action-window/v2/index";
import { COPY_FALLBACK, blockerView, resolveCopy } from "./copy";

/** The generic fallback `blockerView` returns for a code it does not know. */
const GENERIC = blockerView("__no_such_blocker_code__");

describe("blocker copy coverage", () => {
  it("gives every v2 blocker code its own title and body", () => {
    const usingFallback = BLOCKER_CODES.filter((code) => {
      const view = blockerView(code);
      return view.title === GENERIC.title && view.body === GENERIC.body;
    });
    expect(usingFallback, "every blocker code needs wording a seller can act on").toEqual([]);
  });

  it("never describes a stopped run as one that is being prepared", () => {
    for (const code of BLOCKER_CODES) {
      const view = blockerView(code);
      expect(view.title).not.toContain(COPY_FALLBACK);
      expect(view.body).not.toContain(COPY_FALLBACK);
    }
  });

  /**
   * The regression itself, stated as the reason the card no longer uses this lookup: `resolveCopy` answers an
   * unknown blocker key with the PREPARING sentence. Pinned rather than fixed — `COPY_FALLBACK` is right for
   * the step keys it was written for, and it is the wrong lookup for a blocker, which is what changed.
   */
  it("documents why blocker wording does not come from resolveCopy", () => {
    expect(resolveCopy("actionWindow.blocker.RUNTIME_FAULT")).toBe(COPY_FALLBACK);
    expect(blockerView("RUNTIME_FAULT").title).not.toBe(COPY_FALLBACK);
  });
});
