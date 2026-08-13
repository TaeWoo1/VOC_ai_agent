/**
 * **The eight things the manifest promises about a seller's keys, checked against the code that keeps them.**
 *
 * A disclosure is a promise made at the moment someone consents. Prose in a shell script cannot be checked, so
 * these live on the manifest — and living on the manifest is only worth something if each sentence is pinned to
 * the behaviour it describes. Every case below reads the SHIPPING source and fails when the promise stops being
 * true, rather than when someone remembers to reword it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COUPANG_WING_CREDENTIAL_HANDOFF_DISCLOSURE as D,
  COUPANG_WING_CREDENTIAL_HANDOFF_SCOPE,
  PHASE_SPECS,
  validateApprovalPrerequisites,
  type ApprovalPrereqInput,
} from "../../src/cli/approval-manifest";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(resolve(HERE, "../../src", rel), "utf8");

/** A PREPARED handoff manifest, built the way the CLI builds one. */
function handoffManifest() {
  const spec = PHASE_SPECS.COUPANG_WING_CREDENTIAL_HANDOFF;
  const input: ApprovalPrereqInput = {
    phase: "COUPANG_WING_CREDENTIAL_HANDOFF",
    channel: "COUPANG",
    accountBinding: "WING: operator-owned Coupang seller account (the operator's own login)",
    mode: spec.mode,
    apiCenterUrl: "https://wing.coupang.com/",
    cli: spec.cli,
    driver: spec.driver,
    declaredActions: spec.capableActions,
    credentialCellsCalibrated: true,
    runId: "wt-0044d479975f",
    approvalId: "apr-41566347d64c",
    gitSha: "e58a79c8",
    maxActions: "1 operator-confirmed credential read + 1 handoff to the SellerOps backend + 1 read-only connection check",
    surface: "Coupang WING Open API",
    operation: COUPANG_WING_CREDENTIAL_HANDOFF_SCOPE.operation,
  } as ApprovalPrereqInput;
  return validateApprovalPrerequisites(input);
}

describe("the credential manifest discloses what happens to the seller's values", () => {
  it("**carries all eight facts**, and carries them on a CREDENTIAL_READ manifest", () => {
    const res = handoffManifest();
    expect(res.ok, res.ok ? "" : `${res.cause}: ${res.reason}`).toBe(true);
    if (!res.ok) return;
    expect(res.manifest.mode).toBe("CREDENTIAL_READ");
    const d = res.manifest.credentialHandoffDisclosure;
    expect(d).toBeDefined();
    expect(Object.keys(d!).sort()).toEqual(
      [
        "accountBinding",
        "credentialReadBudget",
        "failurePolicy",
        "noPersistence",
        "storage",
        "storedVerifiedSeparation",
        "transport",
        "verification",
      ].sort(),
    );
    for (const [k, v] of Object.entries(d!)) expect(v, k).not.toHaveLength(0);
  });

  it("a READ_ONLY phase carries NONE of it — a run that reads no value promises nothing about one", () => {
    for (const [phase, spec] of Object.entries(PHASE_SPECS)) {
      if (spec.mode === "CREDENTIAL_READ") continue;
      expect(spec.mode, phase).toBe("READ_ONLY");
    }
    // …and the emission is keyed on the MODE, so a future credential phase cannot be added without it.
    expect(src("cli/approval-manifest.ts")).toContain('spec.mode === "CREDENTIAL_READ"');
  });
});

describe("each promise is pinned to the code that keeps it", () => {
  it("ACCOUNT: the slot selects and the JWT authorizes — refused when unset", () => {
    expect(D.accountBinding).toContain("SELLEROPS_ACCOUNT_SLOT");
    const cli = src("cli/run-coupang-credential-handoff-live.ts");
    // The CLI reads the slot and requires the exact 24-hex shape; there is no default.
    expect(cli).toContain('env("SELLEROPS_ACCOUNT_SLOT")');
    expect(cli).toContain("/^[0-9a-f]{24}$/");
  });

  it("BUDGET: exactly one read call site, and one POST", () => {
    expect(D.credentialReadBudget).toContain("ONE read");
    // The value-reading script is built in one module and called from one.
    const driver = src("action-window/coupang-wing-credential-driver.ts");
    expect(driver.split("buildCredentialCellReadScript(").length - 1).toBe(1);
    const client = src("credential/credential-handoff-client.ts");
    // One fetch, and no retry loop around it.
    expect(client.split("fetchImpl(").length - 1).toBe(1);
    expect(client).not.toMatch(/\bfor\s*\(|\bwhile\s*\(/);
  });

  it("TRANSPORT: one POST, to the seller's own backend, over a screened loopback origin", () => {
    expect(D.transport).toContain("/api/agent/credential-handoff");
    expect(src("credential/credential-handoff-client.ts")).toContain("/api/agent/credential-handoff");
    // The destination is screened before anything is read — the boundary guard pins this too.
    expect(src("cli/run-coupang-credential-handoff-live.ts")).toContain("screenCredentialBackendOrigin(cfg.baseUrl)");
    expect(src("credential/backend-origin.ts")).toMatch(/loopback/i);
  });

  it("NO PERSISTENCE: every sink the disclosure names is absent from every module that can hold a value", () => {
    // The disclosure names them; this proves the naming is not aspirational. (The dedicated boundary guard
    // sweeps the same modules — this asserts the PROMISE and the SWEEP describe the same set.)
    for (const named of ["clipboard", "localStorage", "sessionStorage"]) {
      expect(D.noPersistence.toLowerCase()).toContain(named.toLowerCase());
    }
    const holders = [
      "credential/coupang-credential-handoff.ts",
      "credential/credential-handoff-client.ts",
      "action-window/coupang-wing-credential-driver.ts",
      "cli/run-coupang-credential-handoff-live.ts",
    ];
    for (const f of holders) {
      const code = src(f)
        .split("\n")
        .filter((l) => {
          const t = l.trim();
          return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
        })
        .join("\n");
      for (const sink of ["localStorage", "sessionStorage", "navigator.clipboard", "writeFileSync", "process.stdout.write"]) {
        expect(code, `${f} reaches ${sink}`).not.toContain(sink);
      }
    }
    // …and the honest non-claim survives: JS strings cannot be zeroed, and the disclosure says so.
    expect(D.noPersistence).toContain("cannot be zeroed");
  });

  it("STORAGE: the EXISTING vault, and there is no second store", () => {
    expect(D.storage).toContain("EXISTING credential vault");
    const service = readFileSync(
      resolve(HERE, "../../../backend/src/main/java/com/sellerops/collect/AgentCredentialHandoffService.java"),
      "utf8",
    );
    // The handoff delegates; it does not encrypt or persist anything itself.
    expect(service).toContain("collect.storeCredential(");
    expect(service).not.toContain("Cipher");
    expect(service).not.toMatch(/\bsave\(/);
  });

  it("STORED vs VERIFIED: two fields, and a thrown verification still reports the credential stored", () => {
    expect(D.storedVerifiedSeparation).toContain("stored:true");
    const service = readFileSync(
      resolve(HERE, "../../../backend/src/main/java/com/sellerops/collect/AgentCredentialHandoffService.java"),
      "utf8",
    );
    expect(service).toContain("new AgentCredentialHandoffResultView(true, TEST_STATUS_UNVERIFIED, REASON_VERIFY_ERROR)");
  });

  it("VERIFICATION: the same read-only check the operator's own button runs", () => {
    expect(D.verification).toContain("read-only");
    const service = readFileSync(
      resolve(HERE, "../../../backend/src/main/java/com/sellerops/collect/AgentCredentialHandoffService.java"),
      "utf8",
    );
    expect(service).toContain("collect.testConnection(");
  });

  it("FAILURE: never overwrites, and the one-shot is spent at the store", () => {
    expect(D.failurePolicy).toContain("NEVER overwrites");
    const service = readFileSync(
      resolve(HERE, "../../../backend/src/main/java/com/sellerops/collect/AgentCredentialHandoffService.java"),
      "utf8",
    );
    expect(service).toContain("vault.hasCredential(orgId, sellerAccountId)");
    // **Claimed on the NEAR side of the store, atomically.** It used to be marked after, which left a window in
    // which two concurrent requests both passed the read-only check and both stored — harmless for one account
    // (the DB's unique constraint) and two credentials for two. The ordering is the promise.
    const storeAt = service.indexOf("collect.storeCredential(");
    const claimAt = service.indexOf("arming.claim()");
    expect(storeAt).toBeGreaterThan(0);
    expect(claimAt).toBeGreaterThan(0);
    expect(claimAt).toBeLessThan(storeAt);
    // …and the claim's result is acted on, or the race is straight back.
    expect(service).toContain("if (!arming.claim())");
    // A store that THREW hands the claim back — which is what keeps the "retryable" half of this promise true
    // when the refusal comes from inside the store itself.
    expect(service).toContain("arming.releaseUnusedClaim()");
  });

  it("the preflight reads the disclosure from the MANIFEST rather than re-typing it", () => {
    const preflight = readFileSync(
      resolve(HERE, "../../../tools/coupang-local/wing-credential-preflight.sh"),
      "utf8",
    );
    expect(preflight).toContain("credentialHandoffDisclosure");
    // A second copy of these sentences in shell is a second thing that can stop matching the code.
    for (const sentence of Object.values(D)) expect(preflight).not.toContain(sentence);
  });
});
