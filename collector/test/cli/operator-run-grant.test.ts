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
import { withConfirmTail } from "../../src/cli/operator-confirm-host";
import { COUPANG_WING_KEY_DELETION_SCOPE, WING_DEFAULT_ACCOUNT_BINDING } from "../../src/cli/approval-manifest";
import { runApprovalManifestCli } from "../../src/cli/approval-manifest-cli";
import {
  RUN_GRANT_BUTTON_LABEL,
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

/**
 * Drive the REAL manifest CLI for the reveal phase and parse what it printed. Not a fixture: the whole point is
 * that the screen and the manifest agree, and a fixture of the manifest would agree with whatever it was
 * written from.
 */
function renderRevealManifest(): { accountBinding?: string } {
  const saved = { ...process.env };
  let out = "";
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout as any).write = (s: string): boolean => ((out += s), true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stderr as any).write = (): boolean => true;
  try {
    process.env["SELLEROPS_APPROVAL_PHASE"] = "COUPANG_WING_ISSUANCE_FORM_REVEAL";
    process.env["WALKTHROUGH_RUN_ID"] = "wt-1";
    process.env["WALKTHROUGH_APPROVAL_ID"] = "apr-1";
    process.env["WALKTHROUGH_GIT_COMMIT"] = "abc1234";
    runApprovalManifestCli({ verifyIdentity: () => ({ ok: true, head: "abc1234" }) });
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
  const start = out.indexOf("{");
  const end = out.lastIndexOf("}");
  return start >= 0 && end > start ? (JSON.parse(out.slice(start, end + 1)) as { accountBinding?: string }) : {};
}

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
  agentDoesNot: "'발급'을 대신 누르지 않고, 아무것도 입력하지 않으며, 어떤 값도 읽지 않습니다.",
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

  it("**the risk is stated SPECIFICALLY, and never as a word on the title**", () => {
    // `mode` alone cannot carry it: the destructive key deletion is declared `READ_ONLY`, honestly, because the
    // AGENT only reads and the SELLER deletes their own key. But stamping every such title "되돌릴 수 없음"
    // is wrong in the other direction — it makes read-only runs look alarming and teaches the word away.
    const ask = runGrantAsk({ ...BINDING, caution: "삭제된 키는 복구할 수 없습니다" });
    expect(ask.title).toBe("RUN GRANT — READ_ONLY");
    expect(ask.title).not.toContain("되돌릴 수 없음");
    expect(ask.lines[0]).toBe("⚠ 삭제된 키는 복구할 수 없습니다");
    // A run with no risk to state does not open with a blank warning.
    expect(runGrantAsk(BINDING).lines[0]).not.toContain("⚠");
    // The headline is the same either way — it asks the operator to read, and the reading is the screen.
    expect(runGrantAsk(BINDING).headline).toBe("아래 실행 내용을 확인해 주세요.");
  });

  it("**every screen says what SellerOps will NOT do** — half of what is being decided", () => {
    expect(runGrantAsk(BINDING).lines.join("\n")).toContain(`SellerOps는 ${BINDING.agentDoesNot}`);
  });

  it("the ids stay in FULL, on one line, after the run's own description", () => {
    const lines = runGrantAsk(BINDING).lines;
    const idLine = lines.findIndex((l) => l.includes(BINDING.approvalId));
    expect(lines[idLine]).toBe(`승인 ${BINDING.approvalId} · 실행 ${BINDING.runId} · 커밋 ${BINDING.gitSha}`);
    expect(idLine).toBeGreaterThan(lines.findIndex((l) => l.includes(BINDING.operation)));
  });

  it("**says what advances it exactly once**, and the button is named for granting a run", () => {
    // Three different sentences used to tell the operator the same thing: the ask's own tail, the surface's
    // note, and a line in the body. A screen that repeats itself is a screen that gets skimmed.
    const ask = withConfirmTail(runGrantAsk(BINDING), "/tmp/x/run.abort");
    const all = ask.lines.join("\n");
    expect(ask.confirmLabel).toBe(RUN_GRANT_BUTTON_LABEL);
    expect(all).toContain(`[${RUN_GRANT_BUTTON_LABEL}]`);
    expect(all).not.toContain("현재 화면 확인");
    expect(all.match(/누르세요/g) ?? []).toHaveLength(1);
    expect(all.match(/ready/g) ?? []).toHaveLength(1);
  });

  it("tells the operator to stop if the screen disagrees, and that the grant is single-use", () => {
    const lines = runGrantAsk(BINDING).lines.join("\n");
    expect(lines).toContain("다른 내용이 있으면 진행하지 마세요");
    expect(lines).toContain("이 실행 한 번에만 적용됩니다");
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

  it("**every WING run states a specific caution**, and each states its own", () => {
    const cautions = [
      deletionRunGrantBinding().caution,
      revealRunGrantBinding().caution,
      issuanceRunGrantBinding(ENV as unknown as NodeJS.ProcessEnv).caution,
    ];
    for (const c of cautions) expect(c, "a WING run with nothing to caution about").toBeDefined();
    expect(new Set(cautions).size).toBe(3);
    // The deletion run's is the one that says irreversible, because it is.
    expect(deletionRunGrantBinding().caution).toContain("되돌릴 수 없습니다");
    // …and no title carries it as a decoration.
    for (const b of [deletionRunGrantBinding(), revealRunGrantBinding()]) {
      expect(runGrantAsk(b).title).not.toContain("되돌릴 수 없");
    }
  });

  it("**the account is the manifest's own value**, not a second copy of it", () => {
    // Observed live on 2026-08-13 (docs/trusted_operator_confirmation_proof_v1.md): the grant screen read
    // "operator-owned Coupang WING test account" while the Approval Manifest above it read the two-account
    // sentence. One string, one place, or they drift again.
    for (const b of [revealRunGrantBinding(), issuanceRunGrantBinding(ENV as unknown as NodeJS.ProcessEnv)]) {
      expect(b.account).toBe(WING_DEFAULT_ACCOUNT_BINDING);
    }
    expect(deletionRunGrantBinding().account).toBe(COUPANG_WING_KEY_DELETION_SCOPE.accountBinding);
  });

  it("**the grant SCREEN renders the account the real MANIFEST renders**, character for character", () => {
    // Equality of the two constants is necessary and not sufficient: what the operator compares is the LINE on
    // the screen against the LINE on the manifest. So this drives the real manifest CLI for the reveal phase,
    // parses what it emitted, and matches it against the line the grant ask puts on the surface.
    const manifest = renderRevealManifest();
    expect(manifest.accountBinding, "the manifest CLI emitted no account").toBeTruthy();
    const screenLine = runGrantAsk(revealRunGrantBinding()).lines.find((l) => l.startsWith("계정"));
    expect(screenLine, "the grant screen has no account line").toBeDefined();
    expect(screenLine).toBe(`계정      ${manifest.accountBinding}`);
  });

  it("the string the two copies had drifted to is gone from the runs that render this screen", () => {
    // It is still a true description of the WING side alone, which is exactly why it came back once.
    const src = ["run-coupang-wing-reveal-live.ts", "run-coupang-wing-issuance-live.ts", "operator-run-grant.ts"]
      .map((f) => readFileSync(resolve(HERE, "../../src/cli/", f), "utf8"))
      .join("\n");
    expect(src).not.toContain('"operator-owned Coupang WING test account"');
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
