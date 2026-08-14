/**
 * **Live, GATED, human-attended Coupang WING 상품평 structure discovery
 * (`COUPANG_WING_REVIEW_STRUCTURE_DISCOVERY`, READ_ONLY).**
 *
 *   npx tsx src/cli/calibrate-review-list.ts -- --i-understand-this-opens-live-coupang-wing
 *   # optional, for the catalog-scope question:
 *   SELLEROPS_REVIEW_PRODUCT_IDS=productId:15411270785 npx tsx src/cli/calibrate-review-list.ts -- …
 *
 * **One sitting, and it answers the fork.** Coupang publishes no review API — the official documentation lists
 * 11 API categories and no review endpoint among them — and the operator has confirmed that WING has a review
 * screen with no official Excel/CSV export. That leaves one question worth a live run before any acquisition
 * design exists: **does a seller reply control exist on that screen at all?**
 *
 * With one, Coupang review operations can reach a guided human-in-the-loop reply, and the channel is worth the
 * same shape of investment the 고객문의 path got. Without one, the channel is acquisition-and-analysis only and
 * no amount of engineering changes that. Building either before measuring would be building on a guess.
 *
 * **It assumes nothing about what a review row looks like.** Three 고객문의 sittings were spent on probes that
 * decided the page's shape before measuring it — first the row tag, then the attribute location — and each
 * produced a confident zero that read exactly like a real refutation. So the anchors here are Coupang's own
 * fixed field words, and the review unit is whatever repeating structure the most of them AGREE on.
 *
 * **Nothing a customer wrote is read into any returned field.** Review bodies, buyer names, product names and
 * media sources are all on this screen and none of them travels. Page text is read in exactly one function,
 * compared there against fixed Coupang words and date/rating SHAPE patterns we supply, and reduced to a count
 * before it can be returned. A date comes back as which pattern matched and how many times — never a date.
 *
 * It never clicks, types, submits, navigates, highlights, tags, mounts an overlay, or issues a network call.
 *
 * `main()` runs ONLY when invoked directly, so an offline build or import launches nothing.
 */
import type { BrowserContext, Page } from "playwright";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../config";
import { log } from "../log";
import { launchNaverContext } from "../profile";
import { CoupangWingReviewDriver } from "../action-window/coupang-wing-review-driver";
import {
  classifyOwnershipScope,
  classifyReplyCapability,
  type ReviewDigitExpectation,
  type ReviewFrameCensus,
} from "../action-window/coupang-wing-review-list";
import type { OperatorConfirmAsk } from "./operator-confirm";
import { attachOperatorConfirmTab, type ConfirmHostContext } from "./operator-confirm-host";
import { confirmRunGrant, runGrantRefusalMessage, type RunGrantBinding } from "./operator-run-grant";
import {
  COUPANG_WING_REVIEW_DISCOVERY_SCOPE,
  PHASE_SPECS,
  WING_DEFAULT_ACCOUNT_BINDING,
  validateApprovalPrerequisites,
  type ApprovalPrereqInput,
} from "./approval-manifest";
import { resolveWingActionPhase, resolveWingUrl, screenWingUrl } from "./coupang-wing-classifier";
import { verifyRepoIdentity } from "./repo-identity";
import { coupangWingApprovalRequiredMessage, hasCoupangWingRunApproval } from "./live-run-approval";

const DISCOVERY = PHASE_SPECS.COUPANG_WING_REVIEW_STRUCTURE_DISCOVERY;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export const REVIEW_DISCOVERY_OPERATION = COUPANG_WING_REVIEW_DISCOVERY_SCOPE.operation;
const MAX_ACTIONS = COUPANG_WING_REVIEW_DISCOVERY_SCOPE.maxActions;

function env(k: string): string | undefined {
  const v = process.env[k];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

/**
 * The product identifiers to look for, from `SELLEROPS_REVIEW_PRODUCT_IDS` as `id:digits` pairs.
 *
 * **Optional, unlike the 고객문의 calibration's**, and that difference is the point: there is no review id to
 * supply, so this run has to be able to measure a screen it holds no identifier for. What a product id buys is
 * the catalog-scope question — whether the reviews on the screen belong to items we know about.
 *
 * Digits only, and that is a boundary rather than a formatting preference: the string is embedded in a script
 * the page executes. A malformed pair is dropped rather than repaired.
 */
export function parseProductIds(raw: string | undefined): ReviewDigitExpectation[] {
  if (!raw) return [];
  const out: ReviewDigitExpectation[] = [];
  for (const pair of raw.split(",")) {
    const [id, digits] = pair.split(":").map((s) => s.trim());
    if (!id || !digits) continue;
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,32}$/.test(id)) continue;
    if (!/^[0-9]{1,24}$/.test(digits)) continue;
    if (out.some((e) => e.id === id)) continue;
    out.push({ id, digits });
  }
  return out;
}

/** Run the phase's prerequisites through the gate. Returns the sanitized refusal cause, or null when PREPARED. */
export function gateRefusalCause(
  wingUrl: string,
  verifyIdentity: typeof verifyRepoIdentity = verifyRepoIdentity,
): string | null {
  // The PHASE this run is authorized for, before anything else — the WING identity variables are byte-identical
  // across phases, so without this an approval granted for another WING action reaches PREPARED here.
  const phaseBinding = resolveWingActionPhase(process.env, "COUPANG_WING_REVIEW_STRUCTURE_DISCOVERY");
  if (!phaseBinding.ok) return `${phaseBinding.refusal}: ${phaseBinding.reason}`;

  const input: ApprovalPrereqInput = {
    phase: DISCOVERY.phase,
    channel: "COUPANG",
    accountBinding: WING_DEFAULT_ACCOUNT_BINDING,
    mode: DISCOVERY.mode,
    apiCenterUrl: wingUrl,
    cli: DISCOVERY.cli,
    driver: DISCOVERY.driver,
    declaredActions: DISCOVERY.capableActions,
    runId: env("WALKTHROUGH_RUN_ID") ?? "unknown",
    approvalId: env("WALKTHROUGH_APPROVAL_ID") ?? "unknown",
    gitSha: env("WALKTHROUGH_GIT_COMMIT") ?? "unknown",
    maxActions: MAX_ACTIONS,
    surface: "Coupang WING 상품평",
    operation: REVIEW_DISCOVERY_OPERATION,
  };
  const res = validateApprovalPrerequisites(input);
  if (!res.ok) return res.cause;
  const identity = verifyIdentity({ expectedSha: input.gitSha, repoRoot: REPO_ROOT });
  return identity.ok ? null : `${identity.cause}: ${identity.reason}`;
}

/** The manifest fields this run holds, for the run-level grant press. */
export function discoveryRunGrantBinding(): RunGrantBinding {
  return {
    approvalId: env("WALKTHROUGH_APPROVAL_ID") ?? "unknown",
    runId: env("WALKTHROUGH_RUN_ID") ?? "unknown",
    gitSha: env("WALKTHROUGH_GIT_COMMIT") ?? "unknown",
    channel: "COUPANG",
    account: WING_DEFAULT_ACCOUNT_BINDING,
    surface: "Coupang WING 상품평",
    operation: REVIEW_DISCOVERY_OPERATION,
    mode: DISCOVERY.mode,
    maxActions: MAX_ACTIONS,
    agentDoesNot:
      "이 화면이 어떤 구조인지만 한 번 측정합니다 — '평점'·'작성일' 같은 쿠팡 고정 단어가 어느 반복 구조 안에 " +
      "함께 있는지, 판매자 답글 버튼이 있는지, 별점·날짜·번호가 어떤 모양인지. 리뷰 본문·구매자 이름·상품명은 " +
      "읽지 않고, 사진·동영상은 개수만 세며 주소는 읽지 않습니다. 화면 글자는 우리가 넣은 고정 단어·모양 패턴과 " +
      "맞는지만 창 안에서 비교하고 결과로는 개수·태그 이름만 나옵니다. 클릭·입력·답글 등록·전송 없음.",
  };
}

export const DISCOVERY_ABORT_FILENAME = "calibrate-review-list.abort";

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

/** The one checkpoint. It asks the operator to be ON the screen — it cannot verify that itself. */
export function discoveryAsk(): OperatorConfirmAsk {
  return {
    title: "WING 상품평 화면 구조 측정",
    headline: "상품평(리뷰) 목록 화면에 직접 도착하신 뒤 눌러 주세요.",
    lines: [
      "SellerOps는 이 창을 조작하지 않습니다 — 로그인 · 이동은 모두 직접 하세요.",
      "누르시면 이 화면의 구조를 한 번만 측정합니다: 반복 단위, 판매자 답글 버튼 유무, 별점·날짜 표기 모양.",
      "리뷰 본문 · 구매자 이름 · 상품명은 읽지 않습니다. 사진·동영상은 개수만 세고 주소는 읽지 않습니다.",
      "화면의 글자는 이 창 밖으로 나가지 않습니다. 나오는 것은 숫자와 태그 이름뿐입니다.",
      "아무것도 눌리거나 입력되지 않고, 답글은 등록되지 않습니다.",
    ],
  };
}

/** Where the discovery stopped. Only `MEASURED` produced a reading. */
export const DISCOVERY_STOPS = ["ABORTED_BEFORE_CHECKPOINT", "MEASURED"] as const;
export type DiscoveryStop = (typeof DISCOVERY_STOPS)[number];

/**
 * 0 = measured, and the reply-capability question is DECIDED (present, or absent from a reading that
 *     demonstrably reached the reviews)
 * 5 = measured, but the answer is `UNDETERMINED` — a real result, and the one that must not be rounded up:
 *     a screen whose unit never resolved cannot support a claim that Coupang has no reply feature
 * 7 = nothing was measured (refused, aborted, or timed out)
 */
export function discoveryExitCode(stop: DiscoveryStop, decided: boolean): number {
  if (stop !== "MEASURED") return 7;
  return decided ? 0 : 5;
}

export const DISCOVERY_BANNER_LINES: readonly string[] = [
  " LIVE Coupang WING 상품평 structure discovery — explicit per-run approval required.",
  " SellerOps measures WHAT THE SCREEN IS: which repeating unit Coupang's own fixed field words agree",
  " on, whether a seller REPLY CONTROL exists, and what shape the rating / date / id columns have.",
  " No review body, buyer name, or product name is read; photos and videos are counted, never sourced.",
  " Page text is compared in-page against fixed words and shape patterns and only counts come back.",
  " It never clicks, types, submits, navigates, highlights, tags, or issues a network call.",
];

export function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  for (const l of DISCOVERY_BANNER_LINES) console.error(l);
  console.error(line);
}

/**
 * The frame to report on: the one whose review unit actually resolved, else the one whose field words agreed
 * the most. Reporting an arbitrary frame would describe the navigation and call it a refusal.
 */
export function reportableFrame(frames: readonly ReviewFrameCensus[]): ReviewFrameCensus | undefined {
  return (
    frames.find((f) => f.census.unit.resolved) ??
    [...frames].sort((a, b) => b.census.unit.labelsAgreeing - a.census.unit.labelsAgreeing)[0]
  );
}

async function main(): Promise<void> {
  banner();
  const args = process.argv.slice(2);
  if (!hasCoupangWingRunApproval(args)) {
    console.error(coupangWingApprovalRequiredMessage());
    process.exit(3);
    return;
  }
  const productIds = parseProductIds(env("SELLEROPS_REVIEW_PRODUCT_IDS"));
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
      `Refusing to start the 상품평 discovery: approval_prerequisite (${refusal}). No browser launched.`,
    );
    process.exit(4);
    return;
  }

  const cfg = loadConfig();
  const abortPath = sentinelPath(cfg.statusFile, DISCOVERY_ABORT_FILENAME);
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
  const driver = new CoupangWingReviewDriver(confirmHost.entryPage as unknown as Page, {
    context: confirmHost.contextLike as unknown as BrowserContext,
  });
  try {
    // THE RUN-LEVEL GRANT. The approval flag is a statement of intent; this press is the authorization.
    const grant = await confirmRunGrant(confirmHost, discoveryRunGrantBinding());
    log("aw_coupang_review_discovery_run_grant", { outcome: grant });
    if (grant !== "GRANTED") {
      console.error(runGrantRefusalMessage(grant));
      process.exitCode = 7;
      return;
    }

    const ask = discoveryAsk();
    confirmHost.announce(ask);
    const confirmation = await confirmHost.confirm(ask);
    log("aw_coupang_review_discovery_confirm", {
      checkpoint: ask.title,
      signal: confirmation.signal,
      provenance: confirmation.provenance ?? "none",
    });
    if (confirmation.signal !== "ready") {
      console.error("Aborted or timed out before the checkpoint. Nothing was measured.");
      process.exitCode = discoveryExitCode("ABORTED_BEFORE_CHECKPOINT", false);
      return;
    }

    // EVERY frame, not just the top document. A seller center embeds sub-applications.
    const frames = await driver.censusAllFrames(productIds);
    const best = reportableFrame(frames);
    const census = best?.census ?? null;
    const reply = classifyReplyCapability(census);
    const scope = classifyOwnershipScope(census);

    // SANITIZED record → stdout. Integers, tag names, attribute KINDS, and our own expectation ids.
    // No page text, no attribute value, no class name, no selector, no raw URL, no media source.
    console.log(
      JSON.stringify(
        {
          urlCategory: screen.urlCategory,
          phase: DISCOVERY.phase,
          framesScanned: frames.length,
          // Frames are named by INDEX. A frame URL carries the seller's own account path.
          reportedFrameIndex: best?.frameIndex ?? null,
          frames,
          // THE FORK. Reported as its own field so a reader cannot mistake a count for a verdict.
          replyVerdict: reply.verdict,
          replyInteractiveLabelIds: reply.interactiveLabelIds,
          replyPrintedOnly: reply.printedOnly,
          ownershipScope: scope,
          productIdsSupplied: productIds.length,
        },
        null,
        2,
      ),
    );

    if (reply.verdict === "UNDETERMINED") {
      console.error("");
      console.error("⚠ The reply-capability question is UNDETERMINED — the review unit did not resolve.");
      console.error("  Do NOT record this as 'Coupang has no seller reply'. A screen whose rows were never");
      console.error("  found produces exactly this reading whether the control exists or not, and that is the");
      console.error("  confident zero three 고객문의 sittings were spent on.");
    } else if (reply.verdict === "NO_REPLY_CONTROL" && reply.printedOnly) {
      console.error("");
      console.error("ℹ The reply words appear ONLY as printed text — a state column, not a control.");
    }
    process.exitCode = discoveryExitCode("MEASURED", reply.verdict !== "UNDETERMINED");
  } finally {
    removeSentinel(abortPath);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigint);
    await ctx.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((e) => {
    log("aw_coupang_review_discovery_fatal", { reason: e instanceof Error ? e.name || "Error" : typeof e }, "warn");
    process.exit(1);
  });
}
