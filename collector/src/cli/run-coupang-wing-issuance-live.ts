/**
 * Live, GATED, human-attended Coupang WING **API-issuance guidance** entrypoint (ISOLATED, v2 — READ-ONLY).
 *
 *   set -a && . ./.env && set +a          # COUPANG_WING_URL (operator-owned; never logged)
 *   npx tsx src/cli/run-coupang-wing-issuance-live.ts -- --i-understand-this-opens-live-coupang-wing
 *
 * The ONLY entrypoint that fills the Coupang issuance carrier's `createDriver` with the REAL
 * {@link CoupangWingIssuanceDriver} (the default/dev boot never hosts Coupang). It opens the seller's dedicated
 * Chrome window on the WING page and hosts ONE issuance guidance run over the existing authenticated
 * `/bridge/ws` carrier, so the SellerOps FE attaches and drives the guided walk. It NEVER logs in, clicks,
 * types, submits, issues a key (the seller presses 발급 themselves), or reads a credential value — the SELLER
 * performs every real step, and SellerOps only reads a sanitized page category, highlights the next control
 * read-only, and observes the seller's own navigation.
 *
 * Gating mirrors `run-api-issuance-live-naver`, but on its OWN Coupang surface flag (a NAVER grant never opens WING):
 *   - refuses without `--i-understand-this-opens-live-coupang-wing` (`hasCoupangWingRunApproval`);
 *   - reads the operator-owned `COUPANG_WING_URL` (never logged) and `screenWingUrl`-fail-closed BEFORE launching
 *     Chrome, so the browser only ever opens the WING / auth host;
 *   - always closes the context.
 *
 * ⚠ This program NEVER affirms the flag — building/verifying is offline and hermetic, and `main()` runs ONLY
 * when invoked directly (inert on import) so tests launch nothing. LIVE WING IS OUT OF SCOPE THIS UNIT: this is
 * a gated scaffold, never run — do not run it without a fresh, single-use, in-turn operator approval.
 */
import { randomUUID } from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Page } from "playwright";
import { loadConfig } from "../config";
import { log } from "../log";
import { launchNaverContext } from "../profile";
import { CoupangWingIssuanceDriver } from "../action-window/coupang-wing-issuance-driver";
import { createAgentBridge, type AgentBridge } from "../agent/agent-bridge";
import {
  createApprovalPresenterFor,
  decideApprovalPresenter,
  resolveAgentBridgeConfig,
} from "./local-agent";
import { resolveWingUrl, screenWingUrl } from "./coupang-wing-classifier";
import { coupangWingApprovalRequiredMessage, hasCoupangWingRunApproval } from "./live-run-approval";
import { WING_APPROVAL_PHASE_ENV, WING_APPROVED_PHASE_ENV } from "./coupang-wing-classifier";
import { verifyRepoIdentity } from "./repo-identity";

const CHANNEL_CODE = "coupang";

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE Coupang WING API-issuance GUIDED walk — explicit per-run approval required.");
  console.error(" Read-only guidance: the SELLER logs in, reaches the open-API page, selects 자체개발, confirms");
  console.error(" 업체명, sets 호출 IP, presses 발급, and copies the Access Key/Secret Key/업체코드 MANUALLY. This");
  console.error(" tool never logs in, clicks, types, submits, issues a key, or reads any value — it only reads a");
  console.error(" SANITIZED page category, highlights the next control read-only, and OBSERVES the navigation.");
  console.error(line);
}

/** Mint an opaque run id in the same shape the synthetic boot uses (`run_<12 hex>`). */
function mintIssuanceRunId(): string {
  return `run_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** Block until the operator stops the run (SIGINT/SIGTERM), then close the bridge. */
async function waitForShutdown(bridge: AgentBridge): Promise<void> {
  await new Promise<void>((resolve) => {
    const stop = (): void => resolve();
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
  await bridge.close().catch(() => undefined);
}

/**
 * **The fence is LIFTED (2026-08-10), deliberately, and what replaced it is code.**
 *
 * It read: "the shipped 7-step guided plan is contradicted by live WING evidence … and this entrypoint has no
 * approval-manifest gate, no phase binding and no repo-identity check". Every clause of that has been answered
 * rather than argued away:
 *
 *   - the plan was redesigned from five granted READ_ONLY runs — 발급 → PURPOSE(OPEN API, default) → 확인 →
 *     TERMS(2 consents) → the key-creating control — and the two steps for screens this flow never shows are
 *     gone. `self_dev` / `vendor_info` / `call_ip` are no longer guided by anything;
 *   - 발급 is no longer treated as the key-creating press. `checkpoint_before_issue` now rests in front of
 *     `약관 동의 및 Key 발급받기`, and no step follows it that assumes a credential exists;
 *   - this entrypoint now REQUIRES the {@link COUPANG_WING_GUIDED_ISSUANCE_WALK_PHASE} on BOTH phase variables,
 *     verifies repo identity, and no longer navigates the page — the seller does.
 *
 * Lifting it is this diff, which is the reviewable act the fence's own comment asked for.
 */
export const COUPANG_WING_GUIDED_ISSUANCE_WALK_PHASE = "COUPANG_WING_GUIDED_ISSUANCE_WALK" as const;

/**
 * **The agent's navigation budget on this entrypoint: zero.**
 *
 * It used to `page.goto(url)` after launching. On the product path the seller reaches WING themselves, and an
 * agent that navigates has taken a marketplace action nobody granted — the same boundary every read-only WING
 * entrypoint already holds ("this recorder never `.goto`s"). The screened URL is still resolved, because the
 * screen is what keeps the dedicated window pointed at the WING host, but nothing drives the page to it.
 */
/**
 * How many times the agent navigates during a guided walk. **One** — the landing, at window open.
 *
 * It was zero, and the window came up blank: the seller's first task was to find WING themselves, and the
 * run's first reading was `unknown` by construction. Opening a seller's own seller center is not a marketplace
 * action (nothing is clicked, typed, submitted, or selected) but it IS a navigation, so the number says one
 * rather than the claim being quietly softened to "no meaningful navigation".
 *
 * It is a LANDING, not a route: every screen after it is one the seller reaches. Nothing in the walk navigates
 * again, and the guard test holds the count to exactly this.
 */
export const COUPANG_WING_GUIDED_WALK_AGENT_NAVIGATIONS = 1 as const;
  "approval-manifest gate, no phase binding and no repo-identity check";

async function main(): Promise<void> {
  banner();
  const args = process.argv.slice(2);
  // The PHASE gate, checked FIRST — before the approval flag, before URL screening, before anything can open.
  // Two variables that must agree, for the reason every WING gate uses two: with one, a phase left over from an
  // earlier shell arms a run under a manifest granted for different work, and a forgotten phase silently runs
  // something the operator never saw. This walk is the widest WING phase there is; it gets the strictest gate.
  const requested = process.env[WING_APPROVAL_PHASE_ENV];
  const approved = process.env[WING_APPROVED_PHASE_ENV];
  if (requested !== COUPANG_WING_GUIDED_ISSUANCE_WALK_PHASE || approved !== COUPANG_WING_GUIDED_ISSUANCE_WALK_PHASE) {
    console.error(
      `Refusing to start the guided WING issuance walk: both ${WING_APPROVAL_PHASE_ENV} and ` +
        `${WING_APPROVED_PHASE_ENV} must be ${COUPANG_WING_GUIDED_ISSUANCE_WALK_PHASE}. No browser launched.`,
    );
    process.exit(5);
    return;
  }
  // Repo identity, before anything opens: the bootstrap pinned this run to a commit, and a harness pointed at a
  // decoy repository would otherwise satisfy every later check against the wrong tree. The expected SHA travels
  // in the run env the preflight bound, so a run whose code moved since the manifest cannot start.
  const expectedSha = process.env.WALKTHROUGH_GIT_COMMIT ?? "";
  const identity = verifyRepoIdentity({ expectedSha, repoRoot: resolve(dirname(fileURLToPath(import.meta.url)), "../../..") });
  if (!identity.ok) {
    console.error(`Refusing to start: repo identity check failed (${identity.cause}). No browser launched.`);
    process.exit(5);
    return;
  }
  if (!hasCoupangWingRunApproval(args)) {
    console.error(coupangWingApprovalRequiredMessage());
    process.exit(3);
    return;
  }
  // Public WING host is not a secret: default to the WING root, or take an explicit `--url <u>` / positional /
  // COUPANG_WING_URL. The seller logs in + navigates themselves. Fail closed BEFORE launching Chrome: reject
  // placeholders, unparseable URLs, and off-target hosts, so the browser only ever opens the WING / auth host
  // (the raw URL is never printed — only a reason enum + host category).
  const url = resolveWingUrl(args, process.env);
  const screen = screenWingUrl(url);
  if (!screen.ok) {
    console.error(
      `Refusing to launch: COUPANG_WING_URL failed screening (reason=${screen.reason}). It must be the ` +
        "Coupang WING or auth host and not a placeholder. No browser launched.",
    );
    process.exit(2);
    return;
  }

  const cfg = loadConfig();
  const ctx = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  try {
    // The newest tab, wherever the SELLER navigated. This entrypoint never `.goto`s — see
    // COUPANG_WING_GUIDED_WALK_AGENT_NAVIGATIONS. `url` stays resolved and screened so the dedicated window can
    // only be opened against the WING host, but nothing drives the page there.
    const page = (ctx.pages()[0] ?? (await ctx.newPage())) as Page;
    console.error("");
    console.error("GUIDED WALK — log in to WING and reach the open-API 키 발급 page YOURSELF.");
    console.error("  SellerOps does not navigate for you and presses nothing. The on-page panel guides each step.");
    console.error("  ⚠ It STOPS in front of '약관 동의 및 Key 발급받기'. Do not press it in this run.");

    const runId = mintIssuanceRunId();
    const driver = new CoupangWingIssuanceDriver(page, { context: ctx });
    const bridge = createAgentBridge({
      ...resolveAgentBridgeConfig(args, process.env),
      approvalPresenter: createApprovalPresenterFor(decideApprovalPresenter(process.env, process.platform)),
      coupangIssuance: { runId, channelCode: CHANNEL_CODE, createDriver: () => driver },
    });
    const listen = await bridge.listen();
    // Sanitized: the bridge listen result + the opaque runId + channel enum. No URL / value / secret.
    console.log(JSON.stringify({ event: "COUPANG_ISSUANCE_BRIDGE", ...listen, runId, channelCode: CHANNEL_CODE }));
    log("aw_coupang_issuance_live_hosted", { runId, channelCode: CHANNEL_CODE });
    await waitForShutdown(bridge);
  } finally {
    await ctx.close();
  }
}

// Run the live path ONLY when invoked directly (never on import) so hermetic tests launch nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
