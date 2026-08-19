/**
 * **The run identity the handoff presents, and the fact that it is on the wire at all.**
 *
 * The backend arms a credential handoff with the whole identity the operator's grant named — approval, run,
 * commit, phase — and refuses a request that presents anything else. That check is only worth having if the
 * agent actually SENDS it, and "the client puts a field in the body" is exactly the kind of thing that is true
 * until someone refactors the body and nothing notices.
 *
 * So this pins the wire shape, and pins that the CLI builds the binding from the same environment the manifest
 * and the approval gate are built from rather than re-deriving it somewhere new.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { postCoupangCredentialHandoff } from "../../src/credential/credential-handoff-client";

const HERE = dirname(fileURLToPath(import.meta.url));

const BINDING = Object.freeze({
  approvalId: "apr-4c57d35545f8",
  runId: "wt-30bf20bef006",
  gitCommit: "04eded4b",
  phase: "COUPANG_WING_CREDENTIAL_HANDOFF",
});

const SECRETS = Object.freeze({ access_key: "A".repeat(32), secret_key: "B".repeat(40), vendor_id: "V-00099" });

/** A fetch that records the one request and answers a stored+SUCCESS result. */
function capturingFetch() {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const impl = (async (url: string, init: { body: string }) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) as Record<string, unknown> });
    return {
      ok: true,
      status: 200,
      json: async () => ({ stored: true, connectionStatus: "SUCCESS", connectionReason: null }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("the credential handoff presents the run identity it was approved under", () => {
  it("**puts the whole quadruple on the wire**, beside the slot, the channel and the secrets", async () => {
    const { impl, calls } = capturingFetch();
    await postCoupangCredentialHandoff(
      "http://localhost:18091",
      "jwt",
      "0123456789abcdef01234567",
      "COUPANG",
      SECRETS,
      BINDING,
      impl,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://localhost:18091/api/agent/credential-handoff");
    // Each field closes a different way to reuse a grant, so all four have to be there — an assertion on the
    // whole object rather than on one key, because "a binding is present" is not the property.
    expect(calls[0]!.body.runBinding).toEqual(BINDING);
    expect(calls[0]!.body.accountSlot).toBe("0123456789abcdef01234567");
    expect(calls[0]!.body.channelCode).toBe("COUPANG");
  });

  it("still sends exactly ONE request — the identity is a field, not a second round trip", async () => {
    const { impl, calls } = capturingFetch();
    await postCoupangCredentialHandoff("http://localhost:18091", "jwt", "0".repeat(24), "COUPANG", SECRETS, BINDING, impl);
    expect(calls).toHaveLength(1);
  });

  it("the CLI builds the binding from the run env — not from a second source that can disagree", () => {
    const cli = readFileSync(resolve(HERE, "../../instruments/live-runs/run-coupang-credential-handoff-live.ts"), "utf8");
    const fn = cli.slice(cli.indexOf("export function handoffRunBinding()"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    for (const key of ["WALKTHROUGH_APPROVAL_ID", "WALKTHROUGH_RUN_ID", "WALKTHROUGH_GIT_COMMIT"]) {
      expect(body, `the binding does not read ${key}`).toContain(key);
    }
    // The phase comes from the phase spec, never re-typed as a literal beside it.
    expect(body).toContain("HANDOFF.phase");
    // **No placeholder.** `"unknown"` would satisfy the backend's presence check and fail its shape check —
    // which is the right outcome, but a value that LOOKS like an answer is worse than a blank one.
    expect(body).not.toContain('"unknown"');
  });

  it("**the phase literal agrees across the stack** — collector, backend, and the arming script", () => {
    // Three files name this phase and none of them can import the others. A mismatch is silent: the backend
    // refuses a handoff whose phase it does not recognize, at the moment the operator is waiting for it.
    const PHASE = "COUPANG_WING_CREDENTIAL_HANDOFF";
    const java = readFileSync(
      resolve(HERE, "../../../backend/src/main/java/com/sellerops/collect/CredentialHandoffArming.java"),
      "utf8",
    );
    expect(java).toContain(`PHASE_CREDENTIAL_HANDOFF = "${PHASE}"`);
    const armScript = readFileSync(resolve(HERE, "../../../tools/coupang-local/wing-credential-arm-backend.sh"), "utf8");
    expect(armScript).toContain(`EXPECTED_PHASE="${PHASE}"`);
    const bootstrap = readFileSync(resolve(HERE, "../../../tools/coupang-local/wing-credential-bootstrap.sh"), "utf8");
    expect(bootstrap).toContain(`PHASE="${PHASE}"`);
    expect(BINDING.phase).toBe(PHASE);
  });

  it("the arming script takes NO identity argument — there is nothing to hand it", () => {
    // The property that makes "arm it with a value I typed" impossible rather than discouraged: the script
    // reads the minted run env and never an argument or an ambient id.
    const armScript = readFileSync(resolve(HERE, "../../../tools/coupang-local/wing-credential-arm-backend.sh"), "utf8");
    const code = armScript
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("#"))
      .join("\n");
    // No positional arguments are read at all.
    expect(code).not.toMatch(/\$\{?[1-9]/);
    // …and every armed value is assigned from the sourced run env's variables.
    for (const assign of [
      'SELLEROPS_CREDENTIAL_HANDOFF_APPROVAL_ID="$APPROVAL_ID"',
      'SELLEROPS_CREDENTIAL_HANDOFF_RUN_ID="$RUN_ID"',
      'SELLEROPS_CREDENTIAL_HANDOFF_GIT_COMMIT="$RUN_GIT"',
      'SELLEROPS_CREDENTIAL_HANDOFF_PHASE="$PHASE"',
    ]) {
      expect(code).toContain(assign);
    }
  });
});
