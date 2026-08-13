/**
 * **The operator-confirmation channel.**
 *
 * The regression these lock is not a feature: on 2026-08-13 a calibration checkpoint advanced because a `.ready`
 * sentinel was created on the strength of a line of chat text the operator never wrote. Both halves of that — the
 * text and the `touch` — are things a language model can produce, so the tests below are about what the channel
 * REFUSES, not about the happy path.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  OPERATOR_CONFIRM_BUTTON_ID,
  OPERATOR_CONFIRM_BUTTON_LABEL,
  OPERATOR_CONFIRM_CLEAR_SCRIPT,
  OPERATOR_CONFIRM_READ_SCRIPT,
  OPERATOR_CONFIRM_STATE_KEY,
  OPERATOR_UI_CONFIRMED,
  awaitOperatorConfirmation,
  buildOperatorConfirmArmScript,
  isOperatorConfirmToken,
  mintOperatorConfirmToken,
  pageEvaluateTransport,
  verifyOperatorConfirmEvent,
  type OperatorConfirmSeams,
  type OperatorConfirmVerdict,
} from "../../src/cli/operator-confirm";

const ASK = { title: "DISCOVERY 5/7", headline: "press it yourself, then STOP.", lines: ["one", "two"] } as const;

describe("operator confirmation tokens", () => {
  it("mints 32 lowercase hex, and a fresh value every time", () => {
    const a = mintOperatorConfirmToken();
    const b = mintOperatorConfirmToken();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(isOperatorConfirmToken(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it("refuses anything that is not the minted shape", () => {
    for (const bad of ["", "ready", "OPERATOR_UI_CONFIRMED", "A".repeat(32), "0".repeat(31), 1234, null, undefined]) {
      expect(isOperatorConfirmToken(bad)).toBe(false);
    }
  });
});

describe("verifyOperatorConfirmEvent", () => {
  const token = "a".repeat(32);

  it("admits a trusted press carrying this checkpoint's token", () => {
    expect(verifyOperatorConfirmEvent({ token, trusted: true }, token)).toBe("CONFIRMED");
  });

  it("nothing pressed yet is NO_EVENT, not a refusal", () => {
    expect(verifyOperatorConfirmEvent(null, token)).toBe("NO_EVENT");
    expect(verifyOperatorConfirmEvent(undefined, token)).toBe("NO_EVENT");
  });

  it("a press carrying ANOTHER checkpoint's token does not advance this one", () => {
    expect(verifyOperatorConfirmEvent({ token: "b".repeat(32), trusted: true }, token)).toBe("TOKEN_MISMATCH");
  });

  it("an untrusted event is refused even when the token is right", () => {
    // The forgery this closes: something in the page dispatching `new MouseEvent('click')` on the button, or
    // calling `button.click()`. Both leave `isTrusted` false, and neither is a human looking at a screen.
    // It does NOT close a CDP-driven click, which is trusted like a human's — see the module header.
    expect(verifyOperatorConfirmEvent({ token, trusted: false }, token)).toBe("UNTRUSTED_EVENT");
    expect(verifyOperatorConfirmEvent({ token, trusted: "true" }, token)).toBe("UNTRUSTED_EVENT");
    expect(verifyOperatorConfirmEvent({ token }, token)).toBe("UNTRUSTED_EVENT");
  });

  it("anything not shaped like a confirmation is MALFORMED, never interpreted", () => {
    expect(verifyOperatorConfirmEvent("CONFIRMED", token)).toBe("MALFORMED");
    expect(verifyOperatorConfirmEvent(true, token)).toBe("MALFORMED");
    expect(verifyOperatorConfirmEvent({ token: "ready", trusted: true }, token)).toBe("MALFORMED");
    expect(verifyOperatorConfirmEvent({ trusted: true }, token)).toBe("MALFORMED");
  });

  it("an unusable EXPECTATION refuses everything rather than matching by accident", () => {
    // A caller that lost its token would otherwise compare "" against "" and confirm.
    expect(verifyOperatorConfirmEvent({ token: "", trusted: true }, "")).toBe("MALFORMED");
    expect(verifyOperatorConfirmEvent({ token, trusted: true }, "nope")).toBe("MALFORMED");
  });
});

/** A fake confirmation surface: it runs the arm script's OBSERVABLE contract, not its DOM. */
function fakeSurface(o: { press?: "trusted" | "untrusted" | "stale"; afterTicks?: number; armFails?: boolean } = {}): {
  seams: OperatorConfirmSeams;
  verdicts: OperatorConfirmVerdict[];
  armedScripts: string[];
} {
  const verdicts: OperatorConfirmVerdict[] = [];
  const armedScripts: string[] = [];
  let armed: string | null = null;
  let event: unknown = null;
  let reads = 0;
  let pressed = false;
  // Driven through the page transport on purpose: it is what every browser-hosted CLI uses, so these tests
  // exercise the real arm/read/clear scripts rather than a paraphrase of them.
  const evaluate = async (script: string): Promise<unknown> => {
    if (script.includes("(arm)")) {
      if (o.armFails === true) throw new Error("Target page, context or browser has been closed");
      armedScripts.push(script);
      const m = /var TOKEN = "([0-9a-f]{32})"/.exec(script);
      armed = m?.[1] ?? null;
      event = null;
      pressed = false;
      reads = 0;
      return true;
    }
    if (script === OPERATOR_CONFIRM_CLEAR_SCRIPT) {
      event = null;
      return true;
    }
    reads += 1;
    // ONE press per arming, like a human: after a refusal is cleared the page holds nothing until the button
    // is pressed again. A fake that re-presses on every tick would hide whether the host clears refusals.
    if (o.press && reads >= (o.afterTicks ?? 1) && !pressed && armed) {
      pressed = true;
      event =
        o.press === "trusted"
          ? { token: armed, trusted: true }
          : o.press === "untrusted"
            ? { token: armed, trusted: false }
            : { token: "f".repeat(32), trusted: true };
    }
    return event;
  };
  const seams: OperatorConfirmSeams = {
    transport: pageEvaluateTransport(evaluate),
    aborted: () => false,
    sleep: async () => undefined,
    onVerdict: (v) => verdicts.push(v),
  };
  return { seams, verdicts, armedScripts };
}

describe("awaitOperatorConfirmation", () => {
  const opts = { token: mintOperatorConfirmToken(), pollMs: 1, timeoutMs: 20 };

  it("a trusted press returns ready, and the provenance names the channel", async () => {
    const { seams } = fakeSurface({ press: "trusted", afterTicks: 3 });
    const r = await awaitOperatorConfirmation(seams, ASK, opts);
    expect(r).toEqual({ signal: "ready", provenance: OPERATOR_UI_CONFIRMED, choice: "primary" });
  });

  it("no press at all times out — it never falls through to ready", async () => {
    const { seams } = fakeSurface();
    const r = await awaitOperatorConfirmation(seams, ASK, opts);
    expect(r).toEqual({ signal: "timeout", provenance: null });
  });

  it("an untrusted press is recorded and waited through, never accepted", async () => {
    const { seams, verdicts } = fakeSurface({ press: "untrusted" });
    const r = await awaitOperatorConfirmation(seams, ASK, opts);
    expect(r.signal).toBe("timeout");
    expect(verdicts).toContain("UNTRUSTED_EVENT");
    // Cleared, so the same refusal is not re-reported on every remaining tick of a 20-minute wait.
    expect(verdicts.filter((v) => v === "UNTRUSTED_EVENT").length).toBe(1);
  });

  it("a press carrying a foreign token is a mismatch, not an advance", async () => {
    const { seams, verdicts } = fakeSurface({ press: "stale" });
    const r = await awaitOperatorConfirmation(seams, ASK, opts);
    expect(r.signal).toBe("timeout");
    expect(verdicts).toContain("TOKEN_MISMATCH");
  });

  it("the surface is raised ONCE, after arming — never before, and never on a failed arm", async () => {
    // Order matters: raising a surface that still shows the PREVIOUS checkpoint's copy would put the wrong
    // words in front of the operator at the moment they decide.
    const raisedAt: number[] = [];
    const { seams, armedScripts } = fakeSurface({ press: "trusted", afterTicks: 2 });
    const r = await awaitOperatorConfirmation(
      { ...seams, onArmed: () => void raisedAt.push(armedScripts.length) },
      ASK,
      opts,
    );
    expect(r.signal).toBe("ready");
    expect(raisedAt).toEqual([1]);
  });

  it("a surface that will not raise still confirms — raising is best-effort", async () => {
    const { seams } = fakeSurface({ press: "trusted" });
    const r = await awaitOperatorConfirmation(
      {
        ...seams,
        onArmed: () => Promise.reject(new Error("Target page, context or browser has been closed")),
      },
      ASK,
      opts,
    );
    expect(r.signal).toBe("ready");
  });

  it("a surface that cannot be armed fails closed immediately", async () => {
    const raised: string[] = [];
    const { seams, verdicts } = fakeSurface({ armFails: true });
    const r = await awaitOperatorConfirmation({ ...seams, onArmed: () => void raised.push("raised") }, ASK, opts);
    expect(r).toEqual({ signal: "timeout", provenance: null });
    expect(verdicts).toEqual(["UI_NOT_ARMED"]);
    expect(raised).toEqual([]);
  });

  it("an abort is honoured before the surface is armed at all", async () => {
    const { seams } = fakeSurface({ press: "trusted" });
    const r = await awaitOperatorConfirmation({ ...seams, aborted: () => true }, ASK, opts);
    expect(r).toEqual({ signal: "abort", provenance: null });
  });

  it("each checkpoint arms its OWN token — a press held over from the last one cannot advance the next", async () => {
    const { seams, armedScripts } = fakeSurface({ press: "trusted" });
    const first = mintOperatorConfirmToken();
    const second = mintOperatorConfirmToken();
    await awaitOperatorConfirmation(seams, ASK, { ...opts, token: first });
    await awaitOperatorConfirmation(seams, ASK, { ...opts, token: second });
    expect(armedScripts.length).toBe(2);
    expect(armedScripts[0]).toContain(first);
    expect(armedScripts[1]).toContain(second);
    expect(armedScripts[1]).not.toContain(first);
  });
});

describe("the in-page scripts", () => {
  const arm = buildOperatorConfirmArmScript({ ...ASK, token: mintOperatorConfirmToken() });

  it("are ES5-plain string IIFEs with no backtick and no arrow function", () => {
    // Backticks would terminate the TS template literal that carries the script; arrows/`__name` are the esbuild
    // hazard that has broken in-page scripts in this workstream before.
    for (const s of [arm, OPERATOR_CONFIRM_READ_SCRIPT, OPERATOR_CONFIRM_CLEAR_SCRIPT]) {
      expect(s.startsWith("(function ()")).toBe(true);
      expect(s).not.toContain("`");
      expect(s).not.toContain("=>");
      expect(s).not.toContain("__name");
    }
  });

  it("the arm script gates on isTrusted and on its own token", () => {
    expect(arm).toContain("ev.isTrusted !== true");
    expect(arm).toContain("st.armed !== TOKEN");
    expect(arm).toContain(OPERATOR_CONFIRM_BUTTON_ID);
    expect(arm).toContain(OPERATOR_CONFIRM_BUTTON_LABEL);
    expect(arm).toContain(OPERATOR_CONFIRM_STATE_KEY);
  });

  it("renders copy as TEXT — the surface has no innerHTML path", () => {
    expect(arm).toContain("textContent");
    expect(arm).not.toContain("innerHTML");
    expect(arm).not.toContain("insertAdjacentHTML");
    expect(arm).not.toContain("document.write");
  });

  it("**the surface's own note says the tab's business, and does NOT repeat the ask's tail**", () => {
    // What advances the run is said once, in the ask (which the terminal prints and the surface renders). The
    // note used to say it a second time, so the same three sentences reached the operator twice on one screen.
    expect(arm).toContain("이 탭은 SellerOps 화면입니다");
    expect(arm).not.toContain("'ready'라고 쓰거나");
  });

  it("**the primary button takes the ask's own label** — a run grant is not 'check the current screen'", () => {
    const grant = buildOperatorConfirmArmScript({ ...ASK, confirmLabel: "이 실행 승인", token: "a".repeat(32) });
    expect(grant).toContain('"이 실행 승인", "primary"');
    expect(grant).not.toContain(`"${OPERATOR_CONFIRM_BUTTON_LABEL}", "primary"`);
    // …and an ask that says nothing keeps the screen-confirmation label.
    expect(arm).toContain(`"${OPERATOR_CONFIRM_BUTTON_LABEL}", "primary"`);
  });

  it("…and that this tab must not be navigated", () => {
    // The surface paints itself onto whatever document the tab holds, and the host refuses to arm a navigated
    // one — which is fail-closed but costs a live sitting. Saying so is cheaper than halting.
    expect(arm).toContain("다른 주소로 이동하지 마세요");
  });

  it("carries the ask's copy verbatim, so the button is pressed against the instruction it belongs to", () => {
    expect(arm).toContain(JSON.stringify(ASK.title));
    expect(arm).toContain(JSON.stringify(ASK.headline));
    expect(arm).toContain(JSON.stringify(ASK.lines));
  });
});

describe("the module's own boundary", () => {
  const source = readFileSync(resolve(__dirname, "../../src/cli/operator-confirm.ts"), "utf8");

  it("never logs, prints, or persists — the token's only copies are memory and the page", () => {
    const code = source
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("/*") && !l.trimStart().startsWith("//"))
      .join("\n");
    const forbidden = ["console.", "writeFileSync", "appendFileSync", "node:fs", "process.stdout"];
    for (const token of forbidden) {
      expect(code, `operator-confirm must not reach ${token}`).not.toContain(token);
    }
  });
});
