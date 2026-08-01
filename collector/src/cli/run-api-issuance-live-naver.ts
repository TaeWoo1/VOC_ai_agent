/**
 * Live, GATED, human-attended NAVER **API-issuance guidance** entrypoint (ISOLATED, v2 — READ-ONLY guidance).
 *
 *   set -a && . ./.env && set +a          # NAVER_API_CENTER_URL (operator-owned; never logged)
 *   npx tsx src/cli/run-api-issuance-live-naver.ts -- --i-understand-this-opens-live-naver
 *
 * The ONLY entrypoint that fills the issuance carrier's `createDriver` with the REAL
 * {@link NaverIssuanceDriver} (the default/dev boot stays synthetic — `IssuanceFixtureDriver`). It opens the
 * seller's dedicated Chrome window on the API-center page and hosts ONE issuance guidance run over the
 * existing authenticated `/bridge/ws` carrier, so the SellerOps FE attaches and drives the guided walk. It
 * NEVER logs in, clicks, types, submits, creates an application, selects a group, or reads a credential value
 * — the SELLER performs every real step, and SellerOps only reads a sanitized page category, highlights the
 * one next control read-only, and observes the seller's own click.
 *
 * Gating mirrors `observe-api-center` and `run-reply-submission-live-naver`:
 *   - refuses without `--i-understand-this-opens-live-naver` (`hasLiveRunApproval`);
 *   - reads the operator-owned `NAVER_API_CENTER_URL` (never logged) and `screenApiCenterUrl`-fail-closed
 *     BEFORE launching Chrome, so the browser only ever opens the API-center / auth host;
 *   - always closes the context.
 *
 * ⚠ This program NEVER affirms the flag — building/verifying is offline and hermetic, and `main()` runs ONLY
 * when invoked directly (inert on import) so tests launch nothing. Current standing state: NAVER live work is
 * PAUSED — do not run this without a fresh, single-use, in-turn operator approval.
 */
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { Page } from "playwright";
import { loadConfig } from "../config";
import { log } from "../log";
import { launchNaverContext } from "../profile";
import { NaverIssuanceDriver } from "../action-window/naver-issuance-driver";
import { createAgentBridge, type AgentBridge } from "../agent/agent-bridge";
import {
  createApprovalPresenterFor,
  decideApprovalPresenter,
  resolveAgentBridgeConfig,
} from "./local-agent";
import { screenApiCenterUrl } from "./observe-api-center";
import { approvalRequiredMessage, hasLiveRunApproval } from "./live-run-approval";

const CHANNEL_CODE = "naver";

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE NAVER API-issuance GUIDED walk — explicit per-run approval required.");
  console.error(" Read-only guidance: the SELLER logs in, opens/creates the API application, adds the API");
  console.error(" group, and copies the Client ID/Secret MANUALLY. This tool never logs in, clicks, types,");
  console.error(" submits, creates, selects, autofills, or reads any value (incl. Client ID/Secret) — it only");
  console.error(" reads a SANITIZED page category, highlights the next control read-only, and OBSERVES.");
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

async function main(): Promise<void> {
  banner();
  const args = process.argv.slice(2);
  if (!hasLiveRunApproval(args)) {
    console.error(approvalRequiredMessage());
    process.exit(3);
    return;
  }
  const url = process.env.NAVER_API_CENTER_URL;
  if (!url) {
    console.error("Set NAVER_API_CENTER_URL (operator-owned; never logged) to the API-center page first.");
    process.exit(2);
    return;
  }
  // Fail closed BEFORE launching Chrome: reject placeholders, unparseable URLs, and off-target hosts, so the
  // browser only ever opens the API-center / auth host (the raw URL is never printed — only a reason enum).
  const screen = screenApiCenterUrl(url);
  if (!screen.ok) {
    console.error(
      `Refusing to launch: NAVER_API_CENTER_URL failed screening (reason=${screen.reason}). It must be the ` +
        "NAVER API-center or auth host and not a placeholder. No browser launched.",
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
    const driver = new NaverIssuanceDriver(page, { context: ctx });
    const bridge = createAgentBridge({
      ...resolveAgentBridgeConfig(args, process.env),
      approvalPresenter: createApprovalPresenterFor(decideApprovalPresenter(process.env, process.platform)),
      apiIssuance: { runId, channelCode: CHANNEL_CODE, createDriver: () => driver },
    });
    const listen = await bridge.listen();
    // Sanitized: the bridge listen result + the opaque runId + channel enum. No URL / value / secret.
    console.log(JSON.stringify({ event: "ISSUANCE_BRIDGE", ...listen, runId, channelCode: CHANNEL_CODE }));
    log("aw_issuance_live_hosted", { runId, channelCode: CHANNEL_CODE });
    await waitForShutdown(bridge);
  } finally {
    await ctx.close();
  }
}

// Run the live path ONLY when invoked directly (never on import) so hermetic tests launch nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
