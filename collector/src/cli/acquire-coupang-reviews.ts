/**
 * **Live, GATED, human-attended Coupang WING 상품평 acquisition
 * (`COUPANG_WING_REVIEW_ACQUISITION`, READ_ONLY on the marketplace).**
 *
 *   SELLEROPS_REVIEW_ACCOUNT_SLOT=<24 hex> \
 *     npx tsx src/cli/acquire-coupang-reviews.ts -- --i-understand-this-opens-live-coupang-wing
 *
 * **This is the first Coupang review run that takes text out of the page**, and the reason it may is stated
 * rather than assumed: the reviews are the seller's own, read under their own connection, and
 * `docs/sellerops_live_approval_contract.md` §5d holds that the rule is *do not persist unnecessarily*, not
 * *do not read*. What that makes load-bearing is the BUYER — whose column the reader resolves precisely so it
 * can refuse to read it, and for whom no field exists on the wire, in the canonical record, or in the database.
 *
 * **The operator turns every page.** This CLI cannot press the pager, and the shape of the sitting follows
 * from that: one checkpoint per page. The operator brings a page up, presses `현재 화면 확인`, and the run
 * reads it; they page, and press again. A second button ends the walk when they say so. Nothing is clicked,
 * typed, submitted, or navigated on the marketplace at any point.
 *
 * **It walks to the end of the pager, on a first backfill and on a re-sync alike.** Stopping early at a page
 * of familiar reviews would only be sound on a newest-first list, and this screen's sort order has never been
 * proven live. Completion is a READING — the pager itself showing its last page — never an inference, and
 * never the operator's word, which is recorded beside it instead.
 *
 * **The handoff happens once, at the end.** Every page could be posted as it is read, and a page-at-a-time
 * handoff would leave a walk that failed in the middle having stored a prefix of a list under no coverage
 * claim at all. One POST carries what was collected together with what the walk actually established.
 *
 * `main()` runs ONLY when invoked directly, so an offline build or import launches nothing.
 */
import type { BrowserContext, Page } from "playwright";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../config";
import { log } from "../log";
import { login } from "../upload";
import { launchNaverContext } from "../profile";
import { CoupangWingReviewReaderDriver } from "../action-window/coupang-review/coupang-wing-review-reader-driver";
import {
  ReviewAcquisitionSession,
  type AcquisitionResult,
} from "../action-window/coupang-review/review-acquisition";
import {
  postCoupangReviewHandoff,
  ReviewHandoffTransportError,
  type ReviewHandoffResponse,
} from "../action-window/coupang-review/review-handoff-client";
import { backendOriginRefusalMessage, screenCredentialBackendOrigin } from "../credential/backend-origin";
import type { OperatorConfirmAsk } from "./operator-confirm";
import { attachOperatorConfirmTab, type ConfirmHostContext } from "./operator-confirm-host";
import { confirmRunGrant, runGrantRefusalMessage, type RunGrantBinding } from "./operator-run-grant";
import {
  COUPANG_WING_REVIEW_ACQUISITION_SCOPE,
  PHASE_SPECS,
  WING_DEFAULT_ACCOUNT_BINDING,
  validateApprovalPrerequisites,
  type ApprovalPrereqInput,
} from "./approval-manifest";
import { resolveWingActionPhase, resolveWingUrl, screenWingUrl } from "./coupang-wing-classifier";
import { verifyRepoIdentity } from "./repo-identity";
import { coupangWingApprovalRequiredMessage, hasCoupangWingRunApproval } from "./live-run-approval";

const ACQUISITION = PHASE_SPECS.COUPANG_WING_REVIEW_ACQUISITION;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const CHANNEL_CODE = "COUPANG";

export const ACQUISITION_OPERATION = COUPANG_WING_REVIEW_ACQUISITION_SCOPE.operation;
const MAX_ACTIONS = COUPANG_WING_REVIEW_ACQUISITION_SCOPE.maxActions;

function env(k: string): string | undefined {
  const v = process.env[k];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

/**
 * The account this sitting collects for — the opaque `account_session_slot`, the same key the Action Window
 * wire already carries instead of a seller-account id. 24 lowercase hex, screened here rather than at the
 * backend alone: a malformed slot should stop the run before a browser opens, not after a page is read.
 */
export function parseAccountSlot(raw: string | undefined): string | null {
  return raw !== undefined && /^[0-9a-f]{24}$/.test(raw) ? raw : null;
}

/** Run the phase's prerequisites through the gate. Returns the sanitized refusal cause, or null when PREPARED. */
export function gateRefusalCause(
  wingUrl: string,
  verifyIdentity: typeof verifyRepoIdentity = verifyRepoIdentity,
): string | null {
  // The PHASE first: the WING identity variables are byte-identical across phases, so without this an approval
  // granted for the structure DISCOVERY — a run that returns no text — would reach PREPARED for a run that
  // returns review bodies.
  const phaseBinding = resolveWingActionPhase(process.env, "COUPANG_WING_REVIEW_ACQUISITION");
  if (!phaseBinding.ok) return `${phaseBinding.refusal}: ${phaseBinding.reason}`;

  const input: ApprovalPrereqInput = {
    phase: ACQUISITION.phase,
    channel: CHANNEL_CODE,
    accountBinding: WING_DEFAULT_ACCOUNT_BINDING,
    mode: ACQUISITION.mode,
    apiCenterUrl: wingUrl,
    cli: ACQUISITION.cli,
    driver: ACQUISITION.driver,
    declaredActions: ACQUISITION.capableActions,
    runId: env("WALKTHROUGH_RUN_ID") ?? "unknown",
    approvalId: env("WALKTHROUGH_APPROVAL_ID") ?? "unknown",
    gitSha: env("WALKTHROUGH_GIT_COMMIT") ?? "unknown",
    maxActions: MAX_ACTIONS,
    surface: "Coupang WING 상품평",
    operation: ACQUISITION_OPERATION,
  };
  const res = validateApprovalPrerequisites(input);
  if (!res.ok) return res.cause;
  const identity = verifyIdentity({ expectedSha: input.gitSha, repoRoot: REPO_ROOT });
  return identity.ok ? null : `${identity.cause}: ${identity.reason}`;
}

/** The manifest fields this run holds, for the run-level grant press. */
export function acquisitionRunGrantBinding(): RunGrantBinding {
  return {
    approvalId: env("WALKTHROUGH_APPROVAL_ID") ?? "unknown",
    runId: env("WALKTHROUGH_RUN_ID") ?? "unknown",
    gitSha: env("WALKTHROUGH_GIT_COMMIT") ?? "unknown",
    channel: CHANNEL_CODE,
    account: WING_DEFAULT_ACCOUNT_BINDING,
    surface: "Coupang WING 상품평",
    operation: ACQUISITION_OPERATION,
    mode: ACQUISITION.mode,
    maxActions: MAX_ACTIONS,
    agentDoesNot:
      "지금 보이는 페이지의 상품평을 읽어 SellerOps에 저장합니다 — 리뷰 본문 · 별점 · 등록일 · " +
      "노출상품ID(옵션ID) · 리뷰에 붙은 사진/동영상 개수. 열은 쿠팡이 화면에 쓴 머리글로 찾습니다. " +
      "**구매자/작성자 열은 '읽지 않을 열'로 찾아두기만 하고 이름은 읽지 않습니다** — 보내는 곳에도 저장하는 " +
      "곳에도 작성자를 담을 자리가 없습니다. 사진·동영상은 개수만 세고 주소는 읽지 않으며, 화면 HTML이나 " +
      "캡처는 남기지 않습니다. **페이지는 직접 넘겨 주세요 — SellerOps는 넘기지 않습니다.** 쿠팡 화면에서 " +
      "클릭·입력·전송 없음.",
  };
}

export const ACQUISITION_ABORT_FILENAME = "acquire-coupang-reviews.abort";

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

/**
 * The per-page checkpoint. It asks the operator to be ON the page they want read — the run cannot verify that
 * itself, and the second button is the only way the walk can end on their say-so.
 *
 * `pageOrdinal` is how many pages this sitting has already taken, so the copy counts the sitting rather than
 * claiming to know the screen's own page number before it has read it.
 */
export function acquisitionAsk(pageOrdinal: number): OperatorConfirmAsk {
  return {
    title: `상품평 수집 — ${pageOrdinal}번째 페이지`,
    headline: "읽을 상품평 목록 페이지가 화면에 보이면 눌러 주세요.",
    lines: [
      "SellerOps는 이 창을 조작하지 않습니다 — 로그인 · 이동 · 페이지 넘기기는 모두 직접 하세요.",
      "누르시면 지금 보이는 페이지의 상품평을 읽어 SellerOps에 저장합니다: 리뷰 본문, 별점, 등록일, " +
        "노출상품ID(옵션ID), 사진·동영상 개수.",
      "구매자 이름은 읽지 않습니다 — 저장할 자리 자체가 없습니다. 사진·동영상은 개수만 세고 주소는 읽지 않습니다.",
      "같은 상품평은 몇 번을 읽어도 하나로 합쳐집니다. 다시 눌러도 중복 저장되지 않습니다.",
      "다음 페이지를 읽으시려면 쿠팡 화면에서 직접 페이지를 넘긴 뒤 다시 눌러 주세요.",
      "마지막 페이지까지 읽으면 자동으로 끝납니다. 그 전에 그만두시려면 아래 두 번째 버튼을 눌러 주세요.",
      "쿠팡 화면에서는 아무것도 눌리거나 입력되지 않고, 아무것도 전송되지 않습니다.",
    ],
    secondary: { label: "여기까지만 수집하고 끝내기" },
  };
}

/**
 * The locate checkpoint, offered once after the reviews are stored.
 *
 * It exists because the phase DECLARES a highlight, and a declared action a run never performs is a manifest
 * describing more than the run does — the same defect as one describing less. It is also the only way to see,
 * on a real screen, that a stored review can be found again on a list that carries no review id.
 */
export function locateAsk(): OperatorConfirmAsk {
  return {
    title: "저장한 상품평을 화면에서 찾기",
    headline: "방금 저장한 상품평 중 하나가 보이는 페이지를 띄운 뒤 눌러 주세요.",
    lines: [
      "SellerOps가 방금 저장한 상품평을 이 화면에서 다시 찾아 그 줄에 테두리를 그립니다.",
      "쿠팡 상품평에는 리뷰 번호가 없어서, 상품·옵션·날짜·별점·본문이 모두 일치하는 줄을 찾습니다.",
      "일치하는 줄이 정확히 하나일 때만 표시합니다 — 없거나 둘 이상이면 아무것도 표시하지 않습니다.",
      "테두리를 그리고 화면을 그 줄로 스크롤하는 것이 전부입니다. 누르거나 입력하거나 전송하지 않습니다.",
      "건너뛰셔도 됩니다 — 상품평은 이미 저장되었습니다.",
    ],
    secondary: { label: "건너뛰기" },
  };
}

/** Where the sitting stopped. Only `COLLECTED` reached the handoff. */
export const ACQUISITION_STOPS = ["ABORTED_BEFORE_CHECKPOINT", "COLLECTED", "NOTHING_COLLECTED"] as const;
export type AcquisitionStop = (typeof ACQUISITION_STOPS)[number];

/**
 * 0 = collected, the walk reached the end of the pager, and the handoff stored or skipped every row
 * 5 = collected and handed over, but the walk did NOT cover the list (a page it could not read, a pager it
 *     could not resolve, the operator ending it early). A real result, and the one that must not be rounded
 *     up: the reviews are stored and the coverage claim is not made
 * 6 = the handoff itself was refused — nothing is stored, and the sitting has to be re-run
 * 7 = nothing was collected at all (refused, aborted, or timed out)
 */
export function acquisitionExitCode(stop: AcquisitionStop, complete: boolean, handedOff: boolean): number {
  if (stop !== "COLLECTED") return 7;
  if (!handedOff) return 6;
  return complete ? 0 : 5;
}

export const ACQUISITION_BANNER_LINES: readonly string[] = [
  " LIVE Coupang WING 상품평 acquisition — per-run approval required. 0 marketplace actions.",
  " SellerOps READS the reviews on the page the operator brings up and STORES them in SellerOps:",
  " body, rating, 등록일, 노출상품ID (옵션ID), and how many photos/videos the review itself carries.",
  " Columns are resolved from Coupang's own header words. The 구매자/작성자 column is resolved ONLY so",
  " that it can be excluded — no buyer name is read, and no field exists anywhere to store one.",
  " Media are COUNTED, never sourced. No raw HTML, DOM, or screenshot is kept.",
  " THE OPERATOR TURNS EVERY PAGE. This run never clicks, types, submits, or navigates on WING.",
  " A walk is 'complete' only when the pager itself showed its last page — never by inference.",
];

export function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  for (const l of ACQUISITION_BANNER_LINES) console.error(l);
  console.error(line);
}

/** The one-line summary of a finished walk. Counts and enums; no review text can reach it. */
export function summarize(result: AcquisitionResult, handoff: ReviewHandoffResponse | null): string {
  const head =
    `pages=${result.pagesAccepted} rows=${result.rowsRead} collected=${result.reviews.length} ` +
    `textless=${result.textlessCollected} expandable=${result.expandableCollected} ` +
    `complete=${result.complete} stop=${result.stopReason} lastPage=${result.lastPageNumber ?? "?"}`;
  const drops =
    ` dropped(date=${result.dropped.unparseableDate} rating=${result.dropped.unreadableRating} ` +
    `product=${result.dropped.noProductId})`;
  const tail = handoff === null
    ? " handoff=NOT_ATTEMPTED"
    : ` handoff(stored=${handoff.stored} skipped=${handoff.skipped} failed=${handoff.failed}` +
      `${handoff.reason === null ? "" : ` reason=${handoff.reason}`})`;
  return head + drops + tail;
}

async function main(): Promise<void> {
  banner();
  const args = process.argv.slice(2);
  if (!hasCoupangWingRunApproval(args)) {
    console.error(coupangWingApprovalRequiredMessage());
    process.exit(3);
    return;
  }
  const slot = parseAccountSlot(env("SELLEROPS_REVIEW_ACCOUNT_SLOT"));
  if (slot === null) {
    console.error(
      "Refusing to launch: set SELLEROPS_REVIEW_ACCOUNT_SLOT to the 24-hex account slot this sitting collects for. No browser launched.",
    );
    process.exit(2);
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
    console.error(
      `Refusing to start the 상품평 acquisition: approval_prerequisite (${refusal}). No browser launched.`,
    );
    process.exit(4);
    return;
  }

  const cfg = loadConfig();
  // WHERE the reviews would go, screened BEFORE the browser and before the login — the same screen the
  // credential handoff uses, for the same reason: a stale environment value must not be able to send a page of
  // what customers wrote to an arbitrary host.
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
    // Established BEFORE the operator is asked for anything: a login that fails after a page is read would
    // leave the sitting having read reviews it has nowhere to put.
    console.error("Refusing to start: the SellerOps backend session could not be established. No browser launched.");
    process.exit(2);
    return;
  }

  const abortPath = sentinelPath(cfg.statusFile, ACQUISITION_ABORT_FILENAME);
  mkdirSync(dirname(abortPath), { recursive: true });
  removeSentinel(abortPath);

  const abortFlag = { v: false };
  const onSigint = (): void => {
    abortFlag.v = true;
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigint);

  const ctx: BrowserContext = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const confirmHost = await attachOperatorConfirmTab(ctx as unknown as ConfirmHostContext, {
    aborted: () => abortFlag.v || existsSync(abortPath),
    abortPath,
  });
  const driver = new CoupangWingReviewReaderDriver(confirmHost.entryPage as unknown as Page, {
    context: confirmHost.contextLike as unknown as BrowserContext,
  });
  const session = new ReviewAcquisitionSession();
  let stop: AcquisitionStop = "ABORTED_BEFORE_CHECKPOINT";

  try {
    // THE RUN-LEVEL GRANT. The approval flag is a statement of intent; this press is the authorization.
    const grant = await confirmRunGrant(confirmHost, acquisitionRunGrantBinding());
    log("aw_coupang_review_acquisition_run_grant", { outcome: grant });
    if (grant !== "GRANTED") {
      console.error(runGrantRefusalMessage(grant));
      process.exitCode = 7;
      return;
    }

    let ordinal = 1;
    while (session.open) {
      const ask = acquisitionAsk(ordinal);
      confirmHost.announce(ask);
      const confirmation = await confirmHost.confirm(ask);
      log("aw_coupang_review_acquisition_confirm", {
        page: ordinal,
        signal: confirmation.signal,
        provenance: confirmation.provenance ?? "none",
      });
      if (confirmation.signal !== "ready") {
        // An abort or a timeout ends the sitting where it stands. What was already read is still handed over
        // below; what is not claimed is coverage.
        break;
      }
      if (confirmation.choice === "secondary") {
        session.finish();
        break;
      }

      const reading = await driver.readCurrentPage();
      const outcome = session.offerPage(reading);
      log("aw_coupang_review_acquisition_page", {
        page: ordinal,
        readReason: reading.reason,
        accepted: outcome.accepted,
        rows: outcome.rowsRead,
        fresh: outcome.newReviews,
        known: outcome.alreadyKnown,
        stop: outcome.stopReason,
      });
      console.error(
        `  page ${ordinal}: read=${reading.reason} rows=${outcome.rowsRead} new=${outcome.newReviews} ` +
          `known=${outcome.alreadyKnown} -> ${outcome.stopReason}`,
      );
      ordinal += 1;
    }

    const result = session.result();
    stop = result.reviews.length > 0 || result.pagesAccepted > 0 ? "COLLECTED" : "NOTHING_COLLECTED";
    if (stop !== "COLLECTED") {
      console.error(summarize(result, null));
      process.exitCode = acquisitionExitCode(stop, result.complete, false);
      return;
    }
    // **A read page with no reviews on it is not a handoff.** A seller whose 상품평 list is genuinely empty,
    // and a page whose every row was dropped, both arrive here with pages read and nothing to store. Posting
    // that would be an empty batch, which the backend rejects outright — and the operator would be told their
    // sitting FAILED when what actually happened is that there was nothing to collect.
    if (result.reviews.length === 0) {
      console.error(summarize(result, null));
      console.error("  nothing to hand over — the pages read carried no review this run could store.");
      process.exitCode = acquisitionExitCode("NOTHING_COLLECTED", result.complete, false);
      return;
    }

    let handoff: ReviewHandoffResponse | null = null;
    try {
      handoff = await postCoupangReviewHandoff(backend.origin, token, {
        accountSlot: slot,
        channelCode: CHANNEL_CODE,
        complete: result.complete,
        stopReason: result.stopReason,
        reviews: result.reviews,
      });
    } catch (e) {
      // The exception is NOT echoed: a transport failure can quote the request, and the request is a page of
      // what customers wrote.
      const kind = e instanceof ReviewHandoffTransportError ? "TRANSPORT" : "UNKNOWN";
      console.error(`  handoff failed (${kind}). Nothing was stored; re-run the sitting.`);
    }
    console.error(summarize(result, handoff));
    process.exitCode = acquisitionExitCode(stop, result.complete, handoff !== null && handoff.ok);

    // **The locate leg.** Offered only when the reviews are actually stored — ringing a review on the screen
    // to demonstrate that SellerOps "has" it, when the handoff had just failed, would be a demonstration of
    // something untrue. It is offered once, it is skippable, and it changes no exit code: the sitting's result
    // is what it collected.
    if (handoff !== null && handoff.ok && result.reviews.length > 0) {
      const ask = locateAsk();
      confirmHost.announce(ask);
      const confirmation = await confirmHost.confirm(ask);
      if (confirmation.signal === "ready" && confirmation.choice === "primary") {
        const targets = result.reviews.map((r) => ({
          productId: r.productId,
          vendorItemId: r.vendorItemId,
          writtenOn: r.writtenOn,
          rating: r.rating,
          bodyFingerprint: r.bodyFingerprint,
        }));
        const located = await driver.locateAny(targets);
        console.error(
          `  locate: verdict=${located.verdict} matches=${located.matches} rows=${located.rowsConsidered} ` +
            `highlighted=${located.highlighted}`,
        );
      }
    }
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigint);
    removeSentinel(abortPath);
    await ctx.close().catch(() => undefined);
  }
}

// Inert on import: an offline build, a test, or a re-export launches nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
