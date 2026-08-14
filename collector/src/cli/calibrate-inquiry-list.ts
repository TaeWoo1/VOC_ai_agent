/**
 * **Live, GATED, human-attended Coupang WING 고객문의 list calibration
 * (`COUPANG_WING_INQUIRY_LIST_CALIBRATION`, READ_ONLY).**
 *
 *   SELLEROPS_INQUIRY_TARGET_IDS=inquiryId:158421449,productId:15411270785 \
 *     npx tsx src/cli/calibrate-inquiry-list.ts -- --i-understand-this-opens-live-coupang-wing
 *
 * It answers the question the guided reply run cannot be built without: **can SellerOps point at one specific
 * inquiry on that screen at all?** A locator written from a reasonable guess would point the seller at the
 * wrong customer's question, which is worse than pointing at nothing.
 *
 * **It assumes nothing about what a row looks like.** The first calibration defined a row as `tr`/`li`/
 * `[role=row]`, counted 54 of them, and reported zero status words on a screen showing two answered inquiries —
 * it had measured the navigation. So the anchor leads now: an identifier we already hold, searched for
 * document-wide in `href` / `id` / `data-*` and nowhere else, with the repeating structure around it walked
 * outward from wherever it lands.
 *
 * **Buyer text never leaves the page.** The identifiers travel INTO the page (they are ours, from our own
 * database) and what comes back is a count. Text is compared in exactly one place — an `indexOf` against fixed
 * Coupang status words we supply — on leaf elements, reduced to a boolean before it can be returned. Attribute
 * values and class names are likewise compared in-page and never returned.
 *
 * It never clicks, types, submits, navigates, highlights, tags, or mounts an overlay on the WING page.
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
import { CoupangWingInquiryDriver, WING_INQUIRY_STATUS_LABELS } from "../action-window/coupang-wing-inquiry-driver";
import { resolveInquiryTarget, type InquiryDigitExpectation } from "../action-window/coupang-wing-inquiry-list";
import type { OperatorConfirmAsk } from "./operator-confirm";
import { attachOperatorConfirmTab, type ConfirmHostContext } from "./operator-confirm-host";
import { confirmRunGrant, runGrantRefusalMessage, type RunGrantBinding } from "./operator-run-grant";
import {
  COUPANG_WING_INQUIRY_LIST_CALIBRATION_SCOPE,
  PHASE_SPECS,
  WING_DEFAULT_ACCOUNT_BINDING,
  validateApprovalPrerequisites,
  type ApprovalPrereqInput,
} from "./approval-manifest";
import { resolveWingActionPhase, resolveWingUrl, screenWingUrl } from "./coupang-wing-classifier";
import { verifyRepoIdentity } from "./repo-identity";
import { coupangWingApprovalRequiredMessage, hasCoupangWingRunApproval } from "./live-run-approval";

const CALIBRATION = PHASE_SPECS.COUPANG_WING_INQUIRY_LIST_CALIBRATION;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export const INQUIRY_LIST_CALIBRATION_OPERATION = COUPANG_WING_INQUIRY_LIST_CALIBRATION_SCOPE.operation;
const MAX_ACTIONS = COUPANG_WING_INQUIRY_LIST_CALIBRATION_SCOPE.maxActions;

function env(k: string): string | undefined {
  const v = process.env[k];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

/**
 * The identifiers to look for, from `SELLEROPS_INQUIRY_TARGET_IDS` as `id:digits` pairs.
 *
 * Digits only, and that is a boundary rather than a formatting preference: this string is embedded in a script
 * the page executes, so anything that is not a run of digits has no business being there. A malformed pair is
 * dropped rather than repaired — a calibration that silently searched for something other than what the
 * operator named would produce a count nobody could interpret.
 */
export function parseTargetIds(raw: string | undefined): InquiryDigitExpectation[] {
  if (!raw) return [];
  const out: InquiryDigitExpectation[] = [];
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
  const phaseBinding = resolveWingActionPhase(process.env, "COUPANG_WING_INQUIRY_LIST_CALIBRATION");
  if (!phaseBinding.ok) return `${phaseBinding.refusal}: ${phaseBinding.reason}`;

  const input: ApprovalPrereqInput = {
    phase: CALIBRATION.phase,
    channel: "COUPANG",
    accountBinding: WING_DEFAULT_ACCOUNT_BINDING,
    mode: CALIBRATION.mode,
    apiCenterUrl: wingUrl,
    cli: CALIBRATION.cli,
    driver: CALIBRATION.driver,
    declaredActions: CALIBRATION.capableActions,
    runId: env("WALKTHROUGH_RUN_ID") ?? "unknown",
    approvalId: env("WALKTHROUGH_APPROVAL_ID") ?? "unknown",
    gitSha: env("WALKTHROUGH_GIT_COMMIT") ?? "unknown",
    maxActions: MAX_ACTIONS,
    surface: "Coupang WING 고객문의",
    operation: INQUIRY_LIST_CALIBRATION_OPERATION,
  };
  const res = validateApprovalPrerequisites(input);
  if (!res.ok) return res.cause;
  const identity = verifyIdentity({ expectedSha: input.gitSha, repoRoot: REPO_ROOT });
  return identity.ok ? null : `${identity.cause}: ${identity.reason}`;
}

/** The manifest fields this run holds, for the run-level grant press. */
export function calibrationRunGrantBinding(): RunGrantBinding {
  return {
    approvalId: env("WALKTHROUGH_APPROVAL_ID") ?? "unknown",
    runId: env("WALKTHROUGH_RUN_ID") ?? "unknown",
    gitSha: env("WALKTHROUGH_GIT_COMMIT") ?? "unknown",
    channel: "COUPANG",
    account: WING_DEFAULT_ACCOUNT_BINDING,
    surface: "Coupang WING 고객문의",
    operation: INQUIRY_LIST_CALIBRATION_OPERATION,
    mode: CALIBRATION.mode,
    maxActions: MAX_ACTIONS,
    agentDoesNot:
      "SellerOps가 이미 가지고 있는 문의 번호가 이 화면의 링크·id·data 속성 안에 있는지만 찾고, 그 주변이 " +
      "어떤 구조로 반복되는지 셉니다. 화면 글자는 '답변완료' 같은 쿠팡 고정 단어와 맞는지만 비교하고, 결과로는 " +
      "개수만 나옵니다 — 구매자가 쓴 문의 내용은 이 창 밖으로 나가지 않습니다. 클릭·입력·답변 등록·전송 없음.",
  };
}

export const CALIBRATION_ABORT_FILENAME = "calibrate-inquiry-list.abort";

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
export function calibrationAsk(): OperatorConfirmAsk {
  return {
    title: "WING 고객문의 목록 구조 측정",
    headline: "고객문의 목록 화면에 직접 도착하신 뒤 눌러 주세요.",
    lines: [
      "SellerOps는 이 창을 조작하지 않습니다 — 로그인 · 이동은 모두 직접 하세요.",
      "누르시면 화면 구조를 한 번 셉니다.",
      "구매자가 쓴 문의 내용은 이 창 밖으로 나가지 않습니다. 나오는 것은 숫자와 태그 이름뿐입니다.",
      "아무것도 눌리거나 입력되지 않고, 답변은 등록되지 않습니다.",
    ],
  };
}

/** Where the calibration stopped. Only `MEASURED` produced a reading. */
export const CALIBRATION_STOPS = ["ABORTED_BEFORE_CHECKPOINT", "MEASURED"] as const;
export type CalibrationStop = (typeof CALIBRATION_STOPS)[number];

/**
 * 0 = measured, and exactly one row carried the primary identifier (targeting is possible)
 * 5 = measured, but no unambiguous target — a real result, and the one that must not be rounded up
 * 7 = nothing was measured (refused, aborted, or timed out)
 */
export function calibrationExitCode(stop: CalibrationStop, targeted: boolean): number {
  if (stop !== "MEASURED") return 7;
  return targeted ? 0 : 5;
}

export const CALIBRATION_BANNER_LINES: readonly string[] = [
  " LIVE Coupang WING 고객문의 anchor calibration — explicit per-run approval required.",
  " SellerOps looks for an identifier it already holds in href/id/data-* attributes ONLY, and",
  " measures the repeating structure around it. Buyer text never leaves the page: text is",
  " compared to fixed Coupang words in-page and only counts come back. Nothing is sent anywhere.",
  " It never clicks, types, submits, navigates, highlights, or tags the WING page.",
];

export function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  for (const l of CALIBRATION_BANNER_LINES) console.error(l);
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
  const targets = parseTargetIds(env("SELLEROPS_INQUIRY_TARGET_IDS"));
  if (targets.length === 0) {
    console.error(
      "Refusing to start: SELLEROPS_INQUIRY_TARGET_IDS is empty or malformed (expected id:digits pairs, e.g. " +
        "inquiryId:158421449). Without an identifier to look for there is nothing to measure. No browser launched.",
    );
    process.exit(5);
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
      `Refusing to start the 고객문의 calibration: approval_prerequisite (${refusal}). No browser launched.`,
    );
    process.exit(4);
    return;
  }

  const cfg = loadConfig();
  const abortPath = sentinelPath(cfg.statusFile, CALIBRATION_ABORT_FILENAME);
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
  const driver = new CoupangWingInquiryDriver(confirmHost.entryPage as unknown as Page, {
    context: confirmHost.contextLike as unknown as BrowserContext,
  });
  try {
    // THE RUN-LEVEL GRANT. The approval flag is a statement of intent; this press is the authorization.
    const grant = await confirmRunGrant(confirmHost, calibrationRunGrantBinding());
    log("aw_coupang_inquiry_calibration_run_grant", { outcome: grant });
    if (grant !== "GRANTED") {
      console.error(runGrantRefusalMessage(grant));
      process.exitCode = 7;
      return;
    }

    const ask = calibrationAsk();
    confirmHost.announce(ask);
    const confirmation = await confirmHost.confirm(ask);
    log("aw_coupang_inquiry_calibration_confirm", {
      checkpoint: ask.title,
      signal: confirmation.signal,
      provenance: confirmation.provenance ?? "none",
    });
    if (confirmation.signal !== "ready") {
      console.error("Aborted or timed out before the checkpoint. Nothing was measured.");
      process.exitCode = calibrationExitCode("ABORTED_BEFORE_CHECKPOINT", false);
      return;
    }

    // EVERY frame, not just the top document. A seller center embeds sub-applications, and scanning only the
    // top document is the same class of mistake as assuming the row tag — one level up.
    const frames = await driver.censusAllFrames(targets, WING_INQUIRY_STATUS_LABELS);
    // The primary target is the FIRST id the operator named — by convention the channel's own inquiryId.
    // Resolution is asked for that one only; a fallback to a product id would answer a different question.
    const primary = targets[0]!;
    const resolved = frames.find((f) => resolveInquiryTarget(f.census, primary.id).ok);
    // With no resolution anywhere, report against the frame that carried the most machine ids — the one most
    // likely to BE the list — so the refusal describes the best candidate rather than an arbitrary frame.
    const best =
      resolved ??
      [...frames].sort(
        (a, b) => b.census.elementsWithAnchorAttributes - a.census.elementsWithAnchorAttributes,
      )[0];
    const census = best?.census ?? null;
    const resolution = resolveInquiryTarget(census, primary.id);

    // SANITIZED record → stdout. Integers, tag names, attribute KINDS, and our own expectation ids.
    // No page text, no attribute value, no class name, no selector, no raw URL.
    console.log(
      JSON.stringify(
        {
          urlCategory: screen.urlCategory,
          phase: CALIBRATION.phase,
          framesScanned: frames.length,
          // Frames are named by INDEX. A frame URL carries the seller's own account path.
          reportedFrameIndex: best?.frameIndex ?? null,
          frames,
          primaryTargetId: primary.id,
          targetResolved: resolution.ok,
          ...(resolution.ok ? {} : { targetRefusal: resolution.reason }),
        },
        null,
        2,
      ),
    );

    if (census && census.reason === "OK" && census.elementsWithAnchorAttributes === 0) {
      console.error("");
      console.error("⚠ NOTHING on that screen carries a machine-readable number in href / id / data-*.");
      console.error("  That refutes id-based targeting for this surface. It is the measurement, not a failure to");
      console.error("  retry away — and matching on the buyer's text instead is not an available answer.");
    } else if (!resolution.ok) {
      console.error("");
      console.error(`⚠ The target did NOT resolve (${resolution.reason}) for ${primary.id}.`);
      console.error("  Do not hand-write a locator from this output. A guided run may only point at an element");
      console.error("  this measurement resolved to exactly one, with a measured repeat around it.");
    }
    process.exitCode = calibrationExitCode("MEASURED", resolution.ok);
  } finally {
    removeSentinel(abortPath);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigint);
    await ctx.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((e) => {
    log("aw_coupang_inquiry_calibration_fatal", { reason: e instanceof Error ? e.name || "Error" : typeof e }, "warn");
    process.exit(1);
  });
}
