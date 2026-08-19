/**
 * **Live, GATED, human-attended Coupang WING 상품평 LOCATE host
 * (`COUPANG_WING_REVIEW_LOCATE`, READ_ONLY on the marketplace).**
 *
 *   npx tsx instruments/live-runs/run-coupang-review-locate-live.ts -- --i-understand-this-opens-live-coupang-wing
 *
 * It opens the seller's dedicated Chrome window on WING and hosts ONE `REVIEW_LOCATE` run over the existing
 * authenticated `/bridge/ws` carrier, so the SellerOps frontend can attach and press `[쿠팡에서 보기]`. The
 * run itself is the narrowest in this repo: it reads the 상품평 목록 page the seller has up, compares each
 * row against the ONE review they pressed, and outlines the single row that matches on every field.
 *
 * **It stores nothing.** Unlike the acquisition CLI next door — which reads the same rows through the same
 * reader — there is no handoff on this path and no review is written to SellerOps. The only thing this
 * process sends the backend is the opaque binding the frontend gave it, and the only thing it gets back is
 * what the matcher compares.
 *
 * **It performs zero marketplace actions**, including page turns: when the review is not on the page in
 * front of the seller, the run says so and waits while THEY page. The window is opened at the WING host and
 * never navigated again.
 *
 * `main()` runs ONLY when invoked directly, so an offline build or import launches nothing.
 */
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { BrowserContext, Page } from "playwright";
import { loadConfig } from "../../src/config";
import { log } from "../../src/log";
import { login } from "../../src/upload";
import { launchNaverContext } from "../../src/profile";
import { CoupangWingReviewReaderDriver } from "../../src/action-window/coupang-review/coupang-wing-review-reader-driver";
import { CoupangWingReviewLocateDriver } from "../../src/action-window/coupang-review/coupang-wing-review-locate-driver";
import { fetchReviewLocateTarget } from "../../src/action-window/coupang-review/review-locate-target-client";
import { createAgentBridge, type AgentBridge } from "../../src/agent/agent-bridge";
import { backendOriginRefusalMessage, screenCredentialBackendOrigin } from "../../src/credential/backend-origin";
import { attachOperatorConfirmTab, type ConfirmHostContext } from "../../src/cli/operator-confirm-host";
import { confirmRunGrant, runGrantRefusalMessage, type RunGrantBinding } from "../../src/cli/operator-run-grant";
import {
  COUPANG_WING_REVIEW_LOCATE_SCOPE,
  PHASE_SPECS,
  WING_DEFAULT_ACCOUNT_BINDING,
  validateApprovalPrerequisites,
  type ApprovalPrereqInput,
} from "../../src/cli/approval-manifest";
import { resolveWingActionPhase, resolveWingUrl, screenWingUrl } from "../../src/cli/coupang-wing-classifier";
import { verifyRepoIdentity } from "../../src/cli/repo-identity";
import { createApprovalPresenterFor, decideApprovalPresenter, resolveAgentBridgeConfig } from "../../src/cli/local-agent";
import { coupangWingApprovalRequiredMessage, hasCoupangWingRunApproval } from "../../src/cli/live-run-approval";

const LOCATE = PHASE_SPECS.COUPANG_WING_REVIEW_LOCATE;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const CHANNEL_CODE = "COUPANG";
/** The sanitized channel identity on the wire — lowercase, like every other v2 carrier announces. */
const WIRE_CHANNEL_CODE = "coupang";

export const LOCATE_OPERATION = COUPANG_WING_REVIEW_LOCATE_SCOPE.operation;
const MAX_ACTIONS = COUPANG_WING_REVIEW_LOCATE_SCOPE.maxActions;

function env(k: string): string | undefined {
  const v = process.env[k];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

/** Run the phase's prerequisites through the gate. Returns the sanitized refusal cause, or null when PREPARED. */
export function gateRefusalCause(
  wingUrl: string,
  verifyIdentity: typeof verifyRepoIdentity = verifyRepoIdentity,
): string | null {
  // The PHASE first: the WING identity variables are byte-identical across phases, so without this an
  // approval granted for the ACQUISITION — a run that stores what it reads — would reach PREPARED here, and
  // vice versa. Two runs over one screen, and the operator agreed to exactly one of them.
  const phaseBinding = resolveWingActionPhase(process.env, "COUPANG_WING_REVIEW_LOCATE");
  if (!phaseBinding.ok) return `${phaseBinding.refusal}: ${phaseBinding.reason}`;

  const input: ApprovalPrereqInput = {
    phase: LOCATE.phase,
    channel: CHANNEL_CODE,
    accountBinding: WING_DEFAULT_ACCOUNT_BINDING,
    mode: LOCATE.mode,
    apiCenterUrl: wingUrl,
    cli: LOCATE.cli,
    driver: LOCATE.driver,
    declaredActions: LOCATE.capableActions,
    runId: env("WALKTHROUGH_RUN_ID") ?? "unknown",
    approvalId: env("WALKTHROUGH_APPROVAL_ID") ?? "unknown",
    gitSha: env("WALKTHROUGH_GIT_COMMIT") ?? "unknown",
    maxActions: MAX_ACTIONS,
    surface: "Coupang WING 상품평",
    operation: LOCATE_OPERATION,
  };
  const res = validateApprovalPrerequisites(input);
  if (!res.ok) return res.cause;
  const identity = verifyIdentity({ expectedSha: input.gitSha, repoRoot: REPO_ROOT });
  return identity.ok ? null : `${identity.cause}: ${identity.reason}`;
}

/** The manifest fields this run holds, for the run-level grant press. */
export function locateRunGrantBinding(): RunGrantBinding {
  return {
    approvalId: env("WALKTHROUGH_APPROVAL_ID") ?? "unknown",
    runId: env("WALKTHROUGH_RUN_ID") ?? "unknown",
    gitSha: env("WALKTHROUGH_GIT_COMMIT") ?? "unknown",
    channel: CHANNEL_CODE,
    account: WING_DEFAULT_ACCOUNT_BINDING,
    surface: "Coupang WING 상품평",
    operation: LOCATE_OPERATION,
    mode: LOCATE.mode,
    maxActions: MAX_ACTIONS,
    agentDoesNot:
      "SellerOps 화면에서 [쿠팡에서 보기]를 누르시면, 지금 보이는 상품평 목록 페이지를 읽어 **고르신 그 한 " +
      "줄에만** 테두리를 그리고 그 줄로 스크롤합니다. 상품·옵션·등록일·별점·본문이 모두 일치하는 줄이 " +
      "**정확히 하나일 때만** 표시하고, 없거나 둘 이상이면 아무것도 표시하지 않습니다. " +
      "**이 실행은 상품평을 저장하지 않습니다** — 읽어서 비교하고 표시할 뿐입니다. 구매자 이름은 읽지 않고, " +
      "화면 HTML이나 캡처도 남기지 않습니다. **페이지는 직접 넘겨 주세요 — SellerOps는 넘기지 않습니다.** " +
      "쿠팡 화면에서 클릭·입력·전송 없음.",
  };
}

export const LOCATE_BANNER_LINES: readonly string[] = [
  " LIVE Coupang WING 상품평 LOCATE — per-run approval required. 0 marketplace actions.",
  " The seller presses [쿠팡에서 보기] in SellerOps on ONE review it already stored. This run READS the",
  " 상품평 list page they have on screen and OUTLINES the single row that matches on product, option,",
  " date, rating and the review body's fingerprint. Exactly one match, or nothing is outlined.",
  " IT STORES NOTHING. No review is written to SellerOps on this path, and no raw HTML, DOM or",
  " screenshot is kept. The 구매자/작성자 column is resolved ONLY so that it can be excluded.",
  " THE OPERATOR TURNS EVERY PAGE. This run never clicks, types, submits, or navigates on WING.",
];

export function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  for (const l of LOCATE_BANNER_LINES) console.error(l);
  console.error(line);
}

/** Mint an opaque run id in the same shape the synthetic boot uses (`run_<12 hex>`). */
function mintLocateRunId(): string {
  return `run_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** Block until the operator stops the run (SIGINT/SIGTERM), then close the bridge. */
async function waitForShutdown(bridge: AgentBridge): Promise<void> {
  await new Promise<void>((done) => {
    const stop = (): void => done();
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
  await bridge.close().catch(() => undefined);
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
    console.error(
      `Refusing to launch: COUPANG_WING_URL failed screening (reason=${screen.reason}). No browser launched.`,
    );
    process.exit(2);
    return;
  }
  const refusal = gateRefusalCause(url);
  if (refusal) {
    console.error(`Refusing to start the 상품평 locate host: approval_prerequisite (${refusal}). No browser launched.`);
    process.exit(4);
    return;
  }

  const cfg = loadConfig();
  // WHERE the binding is spent, screened BEFORE the browser and before the login — the same screen the
  // credential and review handoffs use. A stale environment value must not be able to send a seller's
  // locateRef to an arbitrary host.
  const backend = screenCredentialBackendOrigin(cfg.baseUrl);
  if (!backend.ok) {
    console.error(backendOriginRefusalMessage(backend.reason));
    process.exit(2);
    return;
  }
  let token: string;
  try {
    token = await login(backend.origin, cfg.email, cfg.password);
  } catch {
    // Established BEFORE anything opens: a session that fails later would leave the seller pressing a button
    // that can never resolve what it is bound to.
    console.error("Refusing to start: the SellerOps backend session could not be established. No browser launched.");
    process.exit(2);
    return;
  }

  const ctx: BrowserContext = await launchNaverContext(cfg.profileDir, cfg.browserChannel, { followWindow: true });
  const confirmHost = await attachOperatorConfirmTab(ctx as unknown as ConfirmHostContext, { aborted: () => false });
  try {
    // THE RUN-LEVEL GRANT. The approval flag is a statement of intent; this press is the authorization.
    const grant = await confirmRunGrant(confirmHost, locateRunGrantBinding());
    log("aw_coupang_review_locate_run_grant", { outcome: grant });
    if (grant !== "GRANTED") {
      console.error(runGrantRefusalMessage(grant));
      process.exitCode = 7;
      return;
    }

    console.error("");
    console.error("LOCATE HOST — log in to WING and reach the 상품평 목록 page YOURSELF.");
    console.error("  SellerOps does not navigate for you and presses nothing — not even the pager.");
    console.error("  Then, in SellerOps, choose a 상품평 and press [쿠팡에서 보기].");

    const runId = mintLocateRunId();
    const surface = confirmHost.contextLike as unknown as BrowserContext;
    const reader = new CoupangWingReviewReaderDriver(confirmHost.entryPage as unknown as Page, {
      context: surface,
      // A locate never reads the pager, and the diagnostic fields are the only place page text reaches a log.
      pagerDiagnostics: false,
    });
    // **Both surface deps are wired, because unwired they are promises the product makes and does not keep.**
    // Without `closed`, the session's "never re-read a window the seller CLOSED" latch can never trip and the
    // poll keeps evaluating for ten minutes against a window that is gone. Without `raiseSurface`, the
    // frontend's [쿠팡 창 앞으로] is a button that always answers `false`.
    const driver = new CoupangWingReviewLocateDriver(reader, {
      raiseSurface: async () => {
        const pages = surface.pages();
        const page = pages.length > 0 ? pages[pages.length - 1] : undefined;
        if (!page) return false;
        await page.bringToFront().catch(() => undefined);
        return true;
      },
      closed: new Promise<void>((resolveClosed) => {
        // The seller's window is "gone" when no page of theirs is left — the SellerOps confirmation tab is
        // filtered out of this list, so closing WING alone is enough, and closing the whole context also is.
        const check = (): void => {
          if (surface.pages().length === 0) resolveClosed();
        };
        const watch = (page: Page): void => {
          page.on("close", check);
        };
        for (const page of surface.pages()) watch(page);
        surface.on("page", watch);
        surface.on("close", () => resolveClosed());
      }),
    });
    const bridge = createAgentBridge({
      ...resolveAgentBridgeConfig(args, process.env),
      approvalPresenter: createApprovalPresenterFor(decideApprovalPresenter(process.env, process.platform)),
      reviewLocate: {
        runId,
        channelCode: WIRE_CHANNEL_CODE,
        createDriver: () => driver,
        // The one call that reaches the backend. It is bound to THIS process's own session, so the binding
        // the frontend hands over is spent by the agent and never resolved in the browser.
        resolveTarget: (locateRef) => fetchReviewLocateTarget(backend.origin, token, locateRef),
      },
    });
    const listen = await bridge.listen();
    // Sanitized: the bridge listen result + the opaque runId + channel enum. No URL / value / target.
    console.log(JSON.stringify({ event: "COUPANG_REVIEW_LOCATE_BRIDGE", ...listen, runId, channelCode: WIRE_CHANNEL_CODE }));
    if (!listen.ok) {
      // Another agent (the resident self-pilot import agent, or the launchd service) already holds the
      // bridge port. Hosting nothing while printing a "hosted" line would leave the seller pressing
      // [쿠팡에서 보기] into a carrier that is not there. Refuse loudly instead (Self-Pilot Runtime v1 audit).
      log("aw_coupang_review_locate_live_refused", { refusal: "BRIDGE_PORT_HELD" }, "error");
      console.error(
        "REFUSED: the bridge port is already held by another agent. Stop it first " +
          "(tools/self-pilot/agent-supervisor.sh switch coupang-locate) and run this again.",
      );
      process.exit(8);
    }
    log("aw_coupang_review_locate_live_hosted", { runId, channelCode: WIRE_CHANNEL_CODE });
    await waitForShutdown(bridge);
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

// Run the live path ONLY when invoked directly (never on import) so hermetic tests launch nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
