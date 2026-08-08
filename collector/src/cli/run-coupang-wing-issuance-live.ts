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
import { pathToFileURL } from "node:url";
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
 * **The guided walk this CLI drives is FENCED OFF, and the fence is code, not a comment.**
 *
 * `coupang-issuance-stages.ts` documents the 7-step plan as contradicted by live evidence and unsafe to run;
 * review pointed out — correctly — that the comment was the only thing stopping it. Concretely: `self_dev` /
 * `call_ip` match 0 and `vendor_info` never resolves on the real no-key surface, so the walk's first three
 * checkpoints cannot be located; and the plan treats 발급 as the key-creating press, so the checkpoint after it
 * tells the seller to copy keys that do not exist. Unlike the reveal and deletion CLIs this entrypoint also has
 * NO approval-manifest gate, NO phase binding and NO repo-identity check, and it navigates the page itself.
 *
 * The fence lifts when the guided plan is redesigned from the Stage-2 observation
 * (`COUPANG_WING_ISSUANCE_FORM_REVEAL`), not before — and lifting it means deleting this constant deliberately,
 * which is a reviewable diff rather than a forgotten comment.
 */
export const COUPANG_WING_GUIDED_ISSUANCE_FENCED = true as const;
export const COUPANG_WING_GUIDED_ISSUANCE_FENCE_REASON =
  "the shipped 7-step guided plan is contradicted by live WING evidence (self_dev/call_ip match 0, vendor_info " +
  "never resolves, and 발급 opens a configuration step rather than creating the key), and this entrypoint has no " +
  "approval-manifest gate, no phase binding and no repo-identity check";

async function main(): Promise<void> {
  banner();
  const args = process.argv.slice(2);
  // The fence, checked FIRST — before the approval flag, before URL screening, before anything can open.
  if (COUPANG_WING_GUIDED_ISSUANCE_FENCED) {
    console.error("Refusing to start the guided WING issuance walk: FENCED.");
    console.error(`  ${COUPANG_WING_GUIDED_ISSUANCE_FENCE_REASON}.`);
    console.error("  Use src/cli/run-coupang-wing-reveal-live.ts (COUPANG_WING_ISSUANCE_FORM_REVEAL) to observe the");
    console.error("  real Stage-2 surface first; the guided plan is redesigned from that evidence, not from this walk.");
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
    const page = (ctx.pages()[0] ?? (await ctx.newPage())) as Page;
    await page.goto(url, { waitUntil: "domcontentloaded" });

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
