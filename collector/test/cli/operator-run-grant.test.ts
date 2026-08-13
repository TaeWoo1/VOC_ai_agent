/**
 * **The run-level grant.**
 *
 * The per-checkpoint sentinel was closed on 2026-08-13; the door the RUN comes through was not. A prepared
 * Approval Manifest was granted by the operator typing `Seated and ready.` into a chat window, after which the
 * assistant started the run by passing the CLI's approval flag — and both of those are things a language model
 * can produce.
 *
 * What these lock is the replacement: a run displays the manifest's own binding fields on the confirmation
 * surface and refuses to start without a verified press, with the flag demoted to a statement of intent.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { OPERATOR_UI_CONFIRMED, type OperatorConfirmAsk, type OperatorConfirmation } from "../../src/cli/operator-confirm";
import {
  confirmRunGrant,
  runGrantAsk,
  runGrantBindingComplete,
  runGrantRefusalMessage,
  type RunGrantBinding,
} from "../../src/cli/operator-run-grant";
import { revealRunGrantBinding } from "../../src/cli/run-coupang-wing-reveal-live";
import { deletionRunGrantBinding } from "../../src/cli/run-coupang-wing-deletion-live";
import { issuanceRunGrantBinding } from "../../src/cli/run-coupang-wing-issuance-live";

const HERE = dirname(fileURLToPath(import.meta.url));

const BINDING: RunGrantBinding = {
  approvalId: "apr-181b4bd2cebf",
  runId: "wt-017b33239e33",
  gitSha: "b95c908f",
  channel: "COUPANG",
  account: "operator-owned Coupang WING test account",
  surface: "Coupang WING Open API",
  operation: "WING issuance-form reveal",
  mode: "READ_ONLY",
  maxActions: "1 operator-performed 발급 press + 1 sanitized observation",
};

/** A surface scripted to answer one way. `announce` is recorded so the ordering can be asserted. */
function host(answer: OperatorConfirmation): {
  announce(ask: OperatorConfirmAsk): void;
  confirm(ask: OperatorConfirmAsk): Promise<OperatorConfirmation>;
  asks: OperatorConfirmAsk[];
} {
  const asks: OperatorConfirmAsk[] = [];
  return {
    asks,
    announce: (ask) => void asks.push(ask),
    confirm: async (ask) => {
      asks.push(ask);
      return answer;
    },
  };
}

const CONFIRMED: OperatorConfirmation = { signal: "ready", provenance: OPERATOR_UI_CONFIRMED, choice: "primary" };

describe("the grant screen shows the manifest's binding, verbatim", () => {
  it("**carries every field a grant binds to**", () => {
    // Root CLAUDE.md names them: channel / account / surface / operation / mode / allowed actions, pinned by
    // approvalId + runId + the commit. A screen missing one is a screen the operator cannot grant against.
    const all = [runGrantAsk(BINDING).title, runGrantAsk(BINDING).headline, ...runGrantAsk(BINDING).lines].join("\n");
    for (const field of Object.values(BINDING)) expect(all, field).toContain(field);
  });

  it("passes the values through rather than summarising them", () => {
    const long = { ...BINDING, operation: "a very specific operation nobody would paraphrase this way" };
    expect(runGrantAsk(long).lines.join("\n")).toContain(long.operation);
  });

  it("**a run that leaves an irreversible mark says so first, above every other field**", () => {
    // `mode` alone cannot carry this. On this workstream the destructive key deletion is declared `READ_ONLY`,
    // and honestly so — the AGENT only reads; the SELLER deletes their own key. A screen reading the mode alone
    // would show `READ_ONLY` above a run that ends with a key gone.
    const ask = runGrantAsk({ ...BINDING, irreversible: "삭제된 키는 복구할 수 없습니다" });
    expect(ask.title).toContain("되돌릴 수 없음");
    expect(ask.headline).toContain("되돌릴 수 없는");
    expect(ask.lines[0]).toContain("삭제된 키는 복구할 수 없습니다");
    expect(runGrantAsk(BINDING).headline).not.toContain("되돌릴 수 없는");
    expect(runGrantAsk({ ...BINDING, mode: "WRITE" }).headline).toContain("되돌릴 수 없는");
  });

  it("tells the operator that not pressing starts nothing, and that the grant is single-use", () => {
    const lines = runGrantAsk(BINDING).lines.join("\n");
    expect(lines).toContain("누르지 않으면 아무것도 시작되지 않습니다");
    expect(lines).toContain("다음 실행은 다시 확인해야 합니다");
  });
});

describe("confirmRunGrant fails closed on every axis", () => {
  it("a verified press grants the run", async () => {
    expect(await confirmRunGrant(host(CONFIRMED), BINDING)).toBe("GRANTED");
  });

  it("**a timeout is a refusal, not a start**", async () => {
    expect(await confirmRunGrant(host({ signal: "timeout", provenance: null }), BINDING)).toBe(
      "REFUSED_NO_CONFIRMATION",
    );
  });

  it("an abort is a refusal with its own cause", async () => {
    expect(await confirmRunGrant(host({ signal: "abort", provenance: null }), BINDING)).toBe("REFUSED_ABORTED");
  });

  it("**an incomplete binding is never SHOWN** — a blank field would be granted against nothing", async () => {
    // A run whose manifest fields did not reach it would otherwise display blanks, and the press would be read
    // as a full authorization of a screen that said nothing.
    for (const missing of ["approvalId", "operation", "mode", "maxActions"] as const) {
      const h = host(CONFIRMED);
      const outcome = await confirmRunGrant(h, { ...BINDING, [missing]: "" });
      expect(outcome, missing).toBe("REFUSED_INCOMPLETE");
      expect(h.asks, missing).toEqual([]);
    }
  });

  it("`unknown` is not a value — it is what an unbound run env produces", async () => {
    // Every CLI's binding builder falls back to the literal "unknown" for a missing env var. Displaying that
    // would be a screen claiming to name an approval it does not have.
    expect(runGrantBindingComplete({ ...BINDING, approvalId: "unknown" })).toBe(false);
    expect(await confirmRunGrant(host(CONFIRMED), { ...BINDING, runId: "unknown" })).toBe("REFUSED_INCOMPLETE");
  });

  it("every refusal message says a chat line and a flag are not a grant", () => {
    expect(runGrantRefusalMessage("REFUSED_NO_CONFIRMATION")).toContain("a chat line");
    expect(runGrantRefusalMessage("REFUSED_INCOMPLETE")).toContain("incomplete");
    expect(runGrantRefusalMessage("REFUSED_ABORTED")).toContain("Nothing was started");
  });
});

describe("the CLIs that hold a manifest bind their grant to it", () => {
  const ENV = {
    WALKTHROUGH_APPROVAL_ID: "apr-1",
    WALKTHROUGH_RUN_ID: "wt-1",
    WALKTHROUGH_GIT_COMMIT: "abc1234",
  };

  it("the guided walk names its own operation and mode, from the phase spec", () => {
    const binding = issuanceRunGrantBinding(ENV as unknown as NodeJS.ProcessEnv);
    expect(runGrantBindingComplete(binding)).toBe(true);
    expect(binding.channel).toBe("COUPANG");
    expect(binding.operation).toContain("약관 동의 및 Key 발급받기");
    expect(binding.approvalId).toBe("apr-1");
  });

  it("**the three WING runs describe three DIFFERENT operations**", () => {
    // A grant binds to what the run does. Three runs sharing one description would let a press against the
    // read-only one read as a press against the destructive one.
    const ops = [revealRunGrantBinding(), deletionRunGrantBinding(), issuanceRunGrantBinding(ENV as unknown as NodeJS.ProcessEnv)].map(
      (b) => b.operation,
    );
    expect(new Set(ops).size).toBe(3);
  });

  it("**the deletion run's grant screen names the irreversible act**, whatever its mode says", () => {
    const binding = deletionRunGrantBinding();
    expect(binding.irreversible).toBeDefined();
    expect(runGrantAsk(binding).title).toContain("되돌릴 수 없음");
    // …and so does the reveal run, whose own banner says it cannot prove no key was created.
    expect(revealRunGrantBinding().irreversible).toBeDefined();
    // The guided walk stops in front of the key-issuing control and claims none.
    expect(issuanceRunGrantBinding(ENV as unknown as NodeJS.ProcessEnv).irreversible).toBeUndefined();
  });

  it("an unbound run env cannot produce a grantable binding", () => {
    // The bootstrap binds these; a shell without them must not reach a screen at all.
    expect(runGrantBindingComplete(issuanceRunGrantBinding({} as unknown as NodeJS.ProcessEnv))).toBe(false);
  });
});

describe("the grant is taken BEFORE the run does anything", () => {
  const src = (f: string): string => readFileSync(resolve(HERE, "../../src/cli/", f), "utf8");

  it("**the reveal walk cannot start before the grant**", () => {
    const body = src("run-coupang-wing-reveal-live.ts");
    const grantIdx = body.indexOf("confirmRunGrant(");
    expect(grantIdx).toBeGreaterThan(-1);
    expect(body.indexOf("runRevealWalk(driver")).toBeGreaterThan(grantIdx);
  });

  it("**the deletion walk cannot classify or highlight before the grant**", () => {
    const body = src("run-coupang-wing-deletion-live.ts");
    const grantIdx = body.indexOf("confirmRunGrant(");
    expect(grantIdx).toBeGreaterThan(-1);
    expect(body.indexOf("classifyAlreadyIssued(")).toBeGreaterThan(grantIdx);
    expect(body.indexOf("highlightDeleteCheckpoint(")).toBeGreaterThan(grantIdx);
  });

  it("**the guided walk's bridge does not listen before the grant**", () => {
    // The bridge is what the frontend pairs to. Listening before the grant would let a walk begin against a
    // manifest nobody had confirmed.
    const body = src("run-coupang-wing-issuance-live.ts");
    const grantIdx = body.indexOf("confirmRunGrant(");
    expect(grantIdx).toBeGreaterThan(-1);
    expect(body.indexOf("bridge.listen()")).toBeGreaterThan(grantIdx);
    expect(body.indexOf("createAgentBridge(")).toBeGreaterThan(grantIdx);
  });
});
