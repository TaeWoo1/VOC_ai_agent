/**
 * **Live, GATED, human-attended Coupang WING credential HANDOFF
 * (`COUPANG_WING_CREDENTIAL_HANDOFF`, mode `CREDENTIAL_READ`).**
 *
 *   npx tsx instruments/live-runs/run-coupang-credential-handoff-live.ts -- --i-understand-this-opens-live-coupang-wing
 *
 * The seller has issued their own WING Open API key and is looking at it. This run asks them, once, on a
 * SellerOps-owned surface; and only if they press it does SellerOps read 업체코드 / Access Key / Secret Key —
 * one read — and hand them straight to the SellerOps backend vault, which verifies them with a read-only Coupang
 * API call. Then it stops.
 *
 * **The seller issued the key.** This run does not click 발급, does not press 확인, does not type, submit,
 * navigate, create, or delete anything on the marketplace. It reads a screen the seller is already looking at.
 *
 * **The values reach nothing else.** Not stdout, not the log, not a file, not the clipboard, not a fixture, and
 * not any assistant's context. The record this prints carries a shape and a per-run salted digest per field —
 * see `docs/coupang_credential_handoff_v1.md` §6 and §8, including what is NOT claimed about erasing plaintext.
 *
 * `main()` runs ONLY when invoked directly, so an offline build or import launches nothing.
 */
import type { BrowserContext, Page } from "playwright";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../../src/config";
import { log } from "../../src/log";
import { launchNaverContext } from "../../src/profile";
import { login } from "../../src/upload";
import { CoupangWingCredentialDriver } from "../../src/action-window/coupang-wing-credential-driver";
import {
  COUPANG_CREDENTIAL_FIELD_IDS,
  WING_CREDENTIAL_CELLS_CALIBRATED,
  credentialCellsResolved,
} from "../../src/action-window/coupang-wing-credential-cells";
import { handOffCoupangCredential, type CredentialHandoffRecord } from "../../src/credential/coupang-credential-handoff";
import {
  postCoupangCredentialHandoff,
  type CredentialHandoffRunBinding,
} from "../../src/credential/credential-handoff-client";
import { backendOriginRefusalMessage, screenCredentialBackendOrigin } from "../../src/credential/backend-origin";
import {
  ACTION_BARRIER_BUTTON_LABEL,
  actionBarrierRefusedMessage,
  barrierRefusedRecord,
  confirmActionBarrier,
  type ActionBarrierSpec,
} from "../../src/cli/operator-action-barrier";
import { attachOperatorConfirmTab, type ConfirmHostContext } from "../../src/cli/operator-confirm-host";
import { confirmRunGrant, runGrantRefusalMessage, type RunGrantBinding } from "../../src/cli/operator-run-grant";
import {
  COUPANG_WING_CREDENTIAL_HANDOFF_SCOPE,
  PHASE_SPECS,
  WING_DEFAULT_ACCOUNT_BINDING,
  validateApprovalPrerequisites,
  type ApprovalPrereqInput,
} from "../../src/cli/approval-manifest";
import { resolveWingActionPhase, resolveWingUrl, screenWingUrl } from "../../src/cli/coupang-wing-classifier";
import { verifyRepoIdentity } from "../../src/cli/repo-identity";
import { coupangWingApprovalRequiredMessage, hasCoupangWingRunApproval } from "../../src/cli/live-run-approval";

const HANDOFF = PHASE_SPECS.COUPANG_WING_CREDENTIAL_HANDOFF;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const CHANNEL_CODE = "COUPANG";

/**
 * The operation sentence and the budget, from the CONTRACT module's own scope — not a second copy of them. The
 * manifest CLI pins the same constants, so the screen the operator presses and the manifest they grant against
 * cannot say different things.
 */
export const CREDENTIAL_HANDOFF_OPERATION = COUPANG_WING_CREDENTIAL_HANDOFF_SCOPE.operation;

const MAX_ACTIONS = COUPANG_WING_CREDENTIAL_HANDOFF_SCOPE.maxActions;

function env(k: string): string | undefined {
  const v = process.env[k];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

/**
 * The account this run stores into, as the opaque server-owned slot — never a seller-account id.
 *
 * Required, and deliberately not defaulted: a handoff with no account named would have to guess which
 * connection the seller's key belongs to, and the failure direction of that guess is a credential stored on the
 * wrong account.
 */
export function accountSlot(): string | null {
  const slot = env("SELLEROPS_ACCOUNT_SLOT");
  return slot && /^[0-9a-f]{24}$/.test(slot) ? slot : null;
}

/** Run the phase's prerequisites through the gate. Returns the sanitized refusal cause, or null when PREPARED. */
export function gateRefusalCause(
  apiCenterUrl: string,
  verifyIdentity: typeof verifyRepoIdentity = verifyRepoIdentity,
  /**
   * Calibration seam. The DEFAULT is the shipped constant, never a hardcoded `true`, so withdrawing the
   * calibration closes this path again without touching the gate — the arrangement the reveal CLI already uses
   * for its own selector calibration, and for the same reason.
   */
  cellsCalibrated: boolean = WING_CREDENTIAL_CELLS_CALIBRATED,
): string | null {
  const phaseBinding = resolveWingActionPhase(process.env, "COUPANG_WING_CREDENTIAL_HANDOFF");
  if (!phaseBinding.ok) return `${phaseBinding.refusal}: ${phaseBinding.reason}`;

  const input: ApprovalPrereqInput = {
    phase: HANDOFF.phase,
    channel: CHANNEL_CODE,
    accountBinding: WING_DEFAULT_ACCOUNT_BINDING,
    mode: HANDOFF.mode,
    apiCenterUrl,
    cli: HANDOFF.cli,
    driver: HANDOFF.driver,
    // The full capability, declared. The gate's credential interlock refuses a CREDENTIAL_READ phase that
    // declares less than it does — a run cannot carry the alarming mode and a reassuring action list.
    declaredActions: HANDOFF.capableActions,
    credentialCellsCalibrated: cellsCalibrated,
    runId: env("WALKTHROUGH_RUN_ID") ?? "unknown",
    approvalId: env("WALKTHROUGH_APPROVAL_ID") ?? "unknown",
    gitSha: env("WALKTHROUGH_GIT_COMMIT") ?? "unknown",
    maxActions: MAX_ACTIONS,
    surface: "Coupang WING Open API",
    operation: CREDENTIAL_HANDOFF_OPERATION,
  };
  const res = validateApprovalPrerequisites(input);
  if (!res.ok) return res.cause;
  const identity = verifyIdentity({ expectedSha: input.gitSha, repoRoot: REPO_ROOT });
  return identity.ok ? null : `${identity.cause}: ${identity.reason}`;
}

/**
 * **The identity this run presents to the backend's credential interlock.**
 *
 * Taken from the SAME env the gate and the manifest are built from, rather than re-derived: the whole property
 * is that the backend was armed with the identity the operator granted against, and a second source for these
 * four values is a second thing that can disagree with the manifest.
 *
 * `unknown` is deliberately NOT substituted for a missing value. A blank field fails the backend's shape check
 * and the handoff is refused — which is the correct outcome for a run whose identity nobody can name, and a
 * quieter failure than a placeholder that looks like an answer.
 */
export function handoffRunBinding(): CredentialHandoffRunBinding {
  return {
    approvalId: env("WALKTHROUGH_APPROVAL_ID") ?? "",
    runId: env("WALKTHROUGH_RUN_ID") ?? "",
    gitCommit: env("WALKTHROUGH_GIT_COMMIT") ?? "",
    phase: HANDOFF.phase,
  };
}

/** The manifest fields this run holds, for the run-level grant press. */
export function handoffRunGrantBinding(): RunGrantBinding {
  return {
    approvalId: env("WALKTHROUGH_APPROVAL_ID") ?? "unknown",
    runId: env("WALKTHROUGH_RUN_ID") ?? "unknown",
    gitSha: env("WALKTHROUGH_GIT_COMMIT") ?? "unknown",
    channel: CHANNEL_CODE,
    account: WING_DEFAULT_ACCOUNT_BINDING,
    surface: "Coupang WING Open API",
    operation: CREDENTIAL_HANDOFF_OPERATION,
    mode: HANDOFF.mode,
    maxActions: MAX_ACTIONS,
    agentDoesNot:
      "'발급'이나 '확인'을 대신 누르지 않고, 아무것도 입력·제출하지 않으며, 키를 새로 만들거나 지우지 않습니다. " +
      "읽은 값은 SellerOps 연결 정보 저장소로만 보내고, 화면·기록·로그·대화창 어디에도 남기지 않습니다.",
    // The mode is not READ_ONLY, and the seller should learn why from a sentence rather than from an enum.
    caution:
      "이 실행에서는 SellerOps가 판매자님의 업체코드 · Access Key · Secret Key 값을 한 번 읽습니다. " +
      "지금까지의 실행과 다른 점이며, 아래 [실행 허용]을 다시 누르셔야만 실제로 읽습니다.",
  };
}

export const HANDOFF_ABORT_FILENAME = "run-coupang-credential-handoff-live.abort";

export function sentinelPath(statusFile: string, filename: string): string {
  return resolve(dirname(resolve(statusFile)), filename);
}

function removeSentinel(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* best-effort */
  }
}

/** The first checkpoint: be on the screen. It reads nothing and allows nothing. */
export function arrivalAsk(): { title: string; headline: string; lines: readonly string[] } {
  return {
    title: "WING 연결 정보 1/2",
    headline: "방금 발급하신 키가 보이는 WING 화면에 직접 도착하신 뒤 눌러 주세요.",
    lines: [
      "SellerOps는 이 창을 조작하지 않습니다 — 로그인 · 이동 · 발급은 모두 판매자님이 하신 것입니다.",
      "이 단계에서는 값을 읽지 않습니다. 어떤 칸이 값을 담고 있는지 구조만 확인하고, 그 칸이 비어 있는지 여부만 봅니다.",
      "값을 읽어도 되는지는 다음 화면에서 다시 여쭙니다.",
    ],
  };
}

/**
 * **The action barrier.** One press, and it discloses the WHOLE chain it authorizes — read, send, verify —
 * because a press that covers a chain and names only its first link has told the operator less than they agreed
 * to. `CREDENTIAL_REVEAL` is the barrier kind; this is its first call site.
 */
export function credentialBarrierSpec(): ActionBarrierSpec {
  return {
    kind: "CREDENTIAL_REVEAL",
    title: "연결 정보 전달",
    headline: "화면에 보이는 업체코드 · Access Key · Secret Key를 SellerOps가 한 번 읽어도 될까요?",
    allows: [
      "화면의 업체코드 · Access Key · Secret Key 값을 한 번만 읽습니다 (다시 읽지 않습니다).",
      "읽은 값을 SellerOps 연결 정보 저장소로 바로 보내 암호화해 보관합니다.",
      "저장된 키로 쿠팡 API에 읽기 전용 요청을 한 번 보내 연결이 되는지 확인합니다.",
    ],
    stillWillNot:
      "값을 화면·기록·로그·파일·클립보드·대화창 어디에도 남기지 않고, 쿠팡에서 아무것도 누르거나 입력하지 " +
      "않으며, 키를 새로 만들거나 지우지 않습니다.",
  };
}

/**
 * 0 = stored, and the read-only connection check passed
 * 5 = stored, but the connection check did not pass (the record carries the safe reason)
 * 6 = the screen did not resolve, or the values were not three distinct things — nothing was sent
 * 7 = the operator did not allow it, or the run was aborted — nothing was read
 * 8 = the backend refused or was unreachable — nothing is stored
 */
export function handoffExitCode(record: CredentialHandoffRecord): number {
  switch (record.outcome) {
    case "STORED_AND_VERIFIED":
      return 0;
    case "STORED_NOT_VERIFIED":
      return 5;
    case "READ_REFUSED":
    case "VALUES_NOT_DISTINCT":
    case "VALUES_NOT_KEY_SHAPED":
      return 6;
    case "NOT_ALLOWED":
      return 7;
    case "STORE_FAILED":
      return 8;
  }
}

export const HANDOFF_BANNER_LINES: readonly string[] = [
  " LIVE Coupang WING credential HANDOFF — explicit per-run approval required.",
  " This run READS 업체코드 / Access Key / Secret Key — once, and only after the seller presses",
  ` [${ACTION_BARRIER_BUTTON_LABEL}] on a SellerOps surface — and hands them to the SellerOps vault.`,
  " The values never reach stdout, the log, a file, the clipboard, or any assistant context.",
  " SellerOps presses nothing on WING: the seller issued the key, and the seller is looking at it.",
];

export function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  for (const l of HANDOFF_BANNER_LINES) console.error(l);
  console.error(line);
}

async function main(): Promise<void> {
  banner();
  const args = process.argv.slice(2);
  if (!hasCoupangWingRunApproval(args)) {
    console.error(coupangWingApprovalRequiredMessage());
    process.exit(3);
    return;
  }
  const url = resolveWingUrl(args, process.env);
  const screen = screenWingUrl(url);
  if (!screen.ok) {
    console.error(`Refusing to launch: COUPANG_WING_URL failed screening (reason=${screen.reason}). No browser launched.`);
    process.exit(2);
    return;
  }
  const refusal = gateRefusalCause(url);
  if (refusal) {
    console.error(`Refusing to start the credential handoff: approval_prerequisite (${refusal}). No browser launched.`);
    process.exit(4);
    return;
  }
  const slot = accountSlot();
  if (!slot) {
    console.error(
      "Refusing to start: SELLEROPS_ACCOUNT_SLOT is missing or malformed (expected 24 lowercase hex). " +
        "A handoff with no account named would have to guess which connection the key belongs to. No browser launched.",
    );
    process.exit(4);
    return;
  }

  const cfg = loadConfig();
  // WHERE the secrets would go, screened BEFORE anything else — ahead of the browser, ahead of the login that
  // would otherwise send the SellerOps password to the same unscreened origin.
  const backend = screenCredentialBackendOrigin(cfg.baseUrl);
  if (!backend.ok) {
    console.error(backendOriginRefusalMessage(backend.reason));
    process.exit(4);
    return;
  }
  const abortPath = sentinelPath(cfg.statusFile, HANDOFF_ABORT_FILENAME);
  mkdirSync(dirname(abortPath), { recursive: true });
  removeSentinel(abortPath);

  const abortFlag = { v: false };
  const onSigint = (): void => {
    abortFlag.v = true;
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigint);

  // The backend session is established BEFORE the operator is asked to allow a read. A login that fails after
  // the barrier would mean three secrets were read for a handoff that could never happen.
  let token: string;
  try {
    token = await login(backend.origin, cfg.email, cfg.password);
  } catch {
    console.error("Refusing to start: could not sign in to the SellerOps backend. No browser launched, nothing read.");
    process.exit(4);
    return;
  }

  const ctx: BrowserContext = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const confirmHost = await attachOperatorConfirmTab(ctx as unknown as ConfirmHostContext, {
    aborted: () => abortFlag.v || existsSync(abortPath),
    abortPath,
  });
  const driver = new CoupangWingCredentialDriver(confirmHost.entryPage as unknown as Page, {
    context: confirmHost.contextLike as unknown as BrowserContext,
  });
  try {
    const grant = await confirmRunGrant(confirmHost, handoffRunGrantBinding());
    log("aw_coupang_credential_handoff_run_grant", { outcome: grant });
    if (grant !== "GRANTED") {
      console.error(runGrantRefusalMessage(grant));
      process.exitCode = 7;
      return;
    }

    const arrival = arrivalAsk();
    confirmHost.announce(arrival);
    const arrived = await confirmHost.confirm(arrival);
    log("aw_coupang_credential_handoff_confirm", {
      checkpoint: arrival.title,
      signal: arrived.signal,
      provenance: arrived.provenance ?? "none",
    });
    if (arrived.signal !== "ready") {
      console.error("Aborted or timed out before the checkpoint. Nothing was read.");
      process.exitCode = 7;
      return;
    }

    // PRE-FLIGHT, value-free: does the screen resolve at all? Asking the operator to allow a read the page
    // cannot satisfy would spend the one press this run gets on a refusal.
    const surface = await driver.classifyInitialSurface();
    if (!surface.ok) {
      console.error(`Refusing: not the issued open-API surface (pageCategory=${surface.observation.pageCategory}). Nothing was read.`);
      process.exitCode = 6;
      return;
    }
    const census = await driver.censusCredentialCells();
    const preflight = credentialCellsResolved(census, COUPANG_CREDENTIAL_FIELD_IDS);
    if (!preflight.ok) {
      console.error(
        `Refusing: the credential cells did not resolve (${preflight.reason}${preflight.id ? ` on ${preflight.id}` : ""}). Nothing was read.`,
      );
      console.error("  Enter the keys in SellerOps yourself — that path has always been there and is unaffected.");
      process.exitCode = 6;
      return;
    }

    const record = await handOffCoupangCredential({
      confirm: async () => {
        const spec = credentialBarrierSpec();
        const allowed = await confirmActionBarrier(confirmHost, spec);
        if (!allowed) {
          console.error(actionBarrierRefusedMessage(spec.kind));
          console.log(barrierRefusedRecord(spec.kind));
          // Returned from the refusal block itself, not after it. The flow this feeds stops on `false` anyway,
          // but "a refused barrier returns HERE" is the property the repo-wide guard reads, and a callback whose
          // stop is two files away is exactly the shape that guard exists to refuse.
          return false;
        }
        return true;
      },
      read: () => driver.readCredentialValues(),
      post: (secrets) =>
        postCoupangCredentialHandoff(backend.origin, token, slot, CHANNEL_CODE, secrets, handoffRunBinding()),
    });

    // The barrier already printed its own refusal record; a second one would double-report the same stop.
    if (record.outcome !== "NOT_ALLOWED") {
      // SANITIZED record → stdout. Outcome, per-field shape, salted digest, and the safe connection status.
      console.log(
        JSON.stringify(
          { urlCategory: screen.urlCategory, phase: HANDOFF.phase, ...record },
          null,
          2,
        ),
      );
    }
    process.exitCode = handoffExitCode(record);
  } finally {
    removeSentinel(abortPath);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigint);
    await ctx.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((e) => {
    log("aw_coupang_credential_handoff_fatal", { reason: e instanceof Error ? e.name || "Error" : typeof e }, "warn");
    process.exit(1);
  });
}
