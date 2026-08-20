/**
 * **NAVER API-issuance guided-walk driver — LIVE surface core (fixture-first, NOT yet live-verified).**
 *
 * The live sibling of `./api-issuance/issuance-fixture-driver.ts` (`IssuanceFixtureDriver`): an
 * {@link IssuanceProbeDriver} that drives the guided API-center onboarding walk over a REAL Playwright
 * `Page` the seller navigated to, instead of a data fixture. It composes the SAME sanitized classifiers the
 * fixture path uses (`observe-api-center`'s census + `api-center-adapter`'s `pageCategoryFromCensus`, so the
 * two can never disagree) and the SAME generic real-page seams the export/reply drivers already use
 * (`overlay` / `observer`), differing only in how it obtains the surface: it reads `page.url()` (reduced to a
 * host CATEGORY, never logged raw) and runs the value-free census in-page.
 *
 * LOCATION IS DELIBERATELY OUTSIDE `api-issuance/` (like `naver-live-driver.ts`) because it legitimately uses
 * `.evaluate` for the census / overlay / read-only tagging. The pure `api-issuance/` runtime carries a strict
 * source guard that forbids `.evaluate` entirely; keeping this driver out of that directory keeps that guard
 * intact. This module has its OWN guard (`naver-issuance-driver-guard.test.ts`) that allows `.evaluate` /
 * `setAttribute` but still forbids every click/type/submit and every field-VALUE read.
 *
 * HARD BOUNDARIES (enforced by that source guard + the offline driver test):
 *   - **No login, click, type, submit, create, or select.** The SELLER performs every real step in their own
 *     window. This driver only reads a sanitized page category, counts candidates, annotates read-only, arms
 *     observation, and reacts to a reported action.
 *   - **No credential read — region PRESENCE only.** For the `credentials` target it detects that a
 *     credential region/control exists (a count + a STRUCTURAL signature); it NEVER reads the Application ID
 *     or Secret value. No `.inputValue`, no `.value` read, no clipboard, no screenshot, no `page.content()`
 *     that carries values, no DOM text projected out. The structural signature is computed IN-PAGE from an
 *     element's tag + position + child count only — never from any value/attribute content.
 *   - **Sanitized outputs only.** Counts, booleans, fixed category enums, and an opaque 16-hex signature. No
 *     selector, raw URL, path, page content, or value ever leaves this module.
 *
 * CALIBRATED highlight locators come from {@link ISSUANCE_TARGET_SELECTORS} (`issuance-highlight-selectors`):
 * each highlightable target is resolved by a FIXED NAVER label (a structural candidate query + an exact label
 * such as "애플리케이션 등록"), derived without drift from the live-confirmed visual-recon adopted set. NAVER's
 * API-center controls expose no aria-label/id, so a fixed label is the only value-free anchor. Boundaries:
 *   - **`open_app` is NAVIGATION guidance, never a highlighted control.** Opening a *specific* existing app
 *     needs that app's identity (no fixed label; a broad structural row anchor measured non-unique live), so the
 *     existing-app step 2 shows text guidance ("연결할 애플리케이션을 직접 열어주세요") and the driver OBSERVES
 *     the seller's own `app_list → app_detail` navigation ({@link NaverIssuanceDriver.observeUserAction} polls
 *     the sanitized page CATEGORY and returns once the list is left). No NAVER control is located, tagged, or
 *     highlighted; the engine verifies the seller reached the detail page before reusing the calibrated
 *     `api_group` / `application_id` / `application_secret` highlights. Its locate/highlight return a fixed synthetic guidance signature.
 *   - **`return` is guidance-only** — never a located NAVER control. Its locate/highlight show the "return to
 *     SellerOps" overlay and return a fixed, synthetic guidance signature (not derived from any page element).
 *   - `CANDIDATE_APP_ENTRY_SELECTOR` remains a `LIVE_DOM_CALIBRATION_PENDING` COUNT-only hypothesis (used to
 *     branch existing-vs-empty). A selector / label never crosses the wire (only the opaque 16-hex signature does).
 */
import type { Page } from "playwright";
import { log } from "../log";
import {
  mountOverlay,
  unmountOverlay,
  overlayMounted,
  resetOverlayAdvance,
  readOverlayAdvancePressed,
  readMountSubStage,
  fingerprintMountFault,
  sanitizeMountMessage,
  type MountSubStage,
} from "./overlay";
import { disarmObserver } from "./observer";
import {
  EXTRACT_API_CENTER_CENSUS,
  classifyUrlCategory,
  type ApiCenterPageCategory,
  type ApiCenterStructuralCensus,
} from "../cli/observe-api-center";
import { pageCategoryFromCensus } from "./api-issuance/api-center-adapter";
import { buildFixedLabelLocateScript } from "./api-issuance-calibration/visual-recon-inpage";
import {
  isGuidedHighlightTarget,
  isIssuanceHighlightTarget,
  isIssuanceNavigationTarget,
  locatorFor,
  type IssuanceHighlightTarget,
} from "./api-issuance-calibration/issuance-highlight-selectors";
import { ISSUANCE_TOTAL_STEPS } from "./api-issuance/issuance-stages";
import type {
  ApplicationsRead,
  IssuanceProbeDriver,
  IssuanceSurfaceProbe,
  IssuanceTarget,
  NaverIssuanceParkNotice,
} from "./api-issuance/issuance-driver";
import type { LocateResult } from "./engine";

/**
 * **CANDIDATE / LIVE_DOM_CALIBRATION_PENDING.** How an application-entry row is counted on the app-list page.
 * Generic list-row structure only — NO NAVER-specific class/id. A COUNT is all that is read (never a name/id
 * value), and a live run must confirm this maps to real application rows.
 */
export const CANDIDATE_APP_ENTRY_SELECTOR = "table tbody tr, ul li, ol li, [role='row']";

/** Default seated-operator observe window (the seller works in the API-center window). Tests override to instant. */
export const DEFAULT_ISSUANCE_OBSERVE_TIMEOUT_MS = 10 * 60_000;

/** Bounded settle before a probe read — best-effort; a thin/never-idle page just fails closed downstream. */
const SETTLE_TIMEOUT_MS = 15_000;

/**
 * Bounded retry for the value-free TAG+SIG in-page annotation that runs AFTER the locator has already resolved a
 * unique, in-view element: a NAVER app-detail SPA soft-navigation can still destroy the execution context under
 * that final `.evaluate`. It is a tiny window now (the locator confirmed a stable unique match first), so a small
 * number of extra attempts covers a transient beat; if every attempt throws the last error propagates and the
 * engine parks recoverably (`onDriveFault`). The RESOLUTION itself (find/uniqueness/scroll) no longer runs through
 * `.evaluate` at all — it is Playwright-locator based (auto-waiting), which is what survives the SPA soft-navs.
 */
const MAX_INPAGE_RETRIES = 2;

/** Pause between annotation retries — lets a one-off soft-navigation re-render land before the next tag read. */
const INPAGE_RETRY_MS = 400;

/**
 * Bounded auto-wait for the Playwright LOCATOR to resolve the fixed-label section. Unlike a raw `page.evaluate`,
 * a locator re-resolves across the SPA's client-side navigations, so this is the primitive that actually survives
 * the "execution context was destroyed" the live proof hit. On timeout the driver returns `{ count: 0 }` and the
 * engine parks `target_not_found` recoverably — a bounded miss, never an infinite wait.
 */
const LOCATOR_TIMEOUT_MS = 8_000;

/**
 * VERIFY_OPEN bounded polling: after the seller opens their existing app, the app-detail SPA hydrates for a beat
 * and can classify as a transient `unknown` before it settles to `app_detail`. So the verify probe polls the
 * sanitized page category up to {@link VERIFY_MAX_POLLS} times ({@link VERIFY_POLL_MS} apart) and returns as soon
 * as it reaches a DEFINITIVE landing (`app_detail` success, or `login` = session lost). If it never settles
 * within the bound it returns the last probe — the engine then parks `page_mismatch` recoverably, never hangs.
 */
const VERIFY_MAX_POLLS = 12;
const VERIFY_POLL_MS = 500;

/** Poll interval while observing the seller's own `app_list → app_detail` navigation for `open_app`. */
const OPEN_NAV_POLL_MS = 1_000;

/** Bounded sleep between navigation-observe polls (no wall-clock read; timer only). */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Escape a fixed label for use inside a RegExp (the label is a calibrated constant, never page-derived text). */
function escapeForRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A whitespace-tolerant EXACT-match RegExp for a FIXED NAVER label, for a locator's `hasText` filter. Playwright
 * normalizes an element's text before testing, so anchoring `^…$` (with optional surrounding whitespace) matches
 * the SAME "candidates whose normalized accessible name equals the label" the audited in-page script asserts —
 * keeping the locator's narrowing consistent with the value-free tag+sig script that follows it.
 */
function exactLabelRegex(label: string): RegExp {
  return new RegExp(`^\\s*${escapeForRegExp(label)}\\s*$`);
}

/** True for a Playwright locator TIMEOUT (a bounded miss → recoverable park), by error NAME only (never message). */
function isTimeout(e: unknown): boolean {
  return e instanceof Error && e.name === "TimeoutError";
}

/**
 * The ordered stages of one fixed-label highlight attempt in {@link NaverIssuanceDriver.resolveFixedLabelTarget}.
 * Emitted as sanitized stage telemetry so a SINGLE gated live diagnostic can name the EXACT stage a drive fault
 * came from (the `API Issuance Live Runtime Reset` left this UNDETERMINED). Observation only — the stage marker
 * changes no control flow.
 *   - `resolve`       — the Playwright locator's bounded `waitFor(attached)` + uniqueness `count()`.
 *   - `scroll`        — `scrollIntoViewIfNeeded` (best-effort; its own error is swallowed, logged separately).
 *   - `tag`           — the audited value-free fixed-label tag+sig `.evaluate`.
 *   - `mount`         — the overlay mount (`afterTag`).
 *   - `visible_check` — the post-mount `overlayMounted` paint verify.
 */
type IssuanceStage = "resolve" | "scroll" | "tag" | "mount" | "visible_check";

/**
 * A FIXED, sanitized reason enum for a highlight fault — the ONLY failure detail emitted alongside the stage and
 * the error NAME. Classified by branching on the error name/message, but the raw message is NEVER logged: only
 * this closed enum leaves the driver, so no page value / text / URL / selector can ride out. Playwright's own
 * fault messages ("Execution context was destroyed", "Target closed", …) carry no page content, but we still
 * reduce them to this enum rather than emit them, per the calibration scope's "고정 reason enum만 기록".
 */
type IssuanceFaultReason =
  | "TIMEOUT"
  | "CONTEXT_DESTROYED"
  | "FRAME_DETACHED"
  | "TARGET_CLOSED"
  | "NO_PAINT"
  | "OTHER";

/** The error's constructor NAME only (never its message) — the one identity token the telemetry may carry. */
function errName(e: unknown): string {
  return e instanceof Error ? e.name || "Error" : typeof e;
}

/**
 * Map a thrown value to the fixed {@link IssuanceFaultReason}. Branches on the message for control flow ONLY;
 * the message itself is never returned or logged. `NO_PAINT` matches this driver's own overlay-not-painted throw
 * so a visible-check failure is distinct from a context-destroyed one — the exact distinction the root-cause
 * isolation needs.
 */
function classifyFaultReason(e: unknown): IssuanceFaultReason {
  if (e instanceof Error && e.name === "TimeoutError") return "TIMEOUT";
  const msg = e instanceof Error ? e.message : "";
  if (msg.includes("no painted overlay")) return "NO_PAINT";
  if (msg.includes("context was destroyed") || msg.includes("Execution context was destroyed")) return "CONTEXT_DESTROYED";
  if (msg.includes("frame was detached") || msg.includes("Frame was detached")) return "FRAME_DETACHED";
  if (msg.includes("Target closed") || msg.includes("Target page, context or browser has been closed")) return "TARGET_CLOSED";
  return "OTHER";
}

/**
 * A DEFINITIVE `open_app` landing category for VERIFY_OPEN polling — the categories that STOP the poll because
 * they will not change under further hydration:
 *   - `app_detail` / `credential_issuance` — the seller reached their application's own detail page (an existing
 *     app shows its issued Application ID / Secret read-only, which the shared classifier calls
 *     `credential_issuance`); both are a SUCCESS landing the engine accepts.
 *   - `login` — the session expired mid-open (a recoverable park).
 * Transient hydration states (`unknown`, still-`app_list`) are NOT definitive — keep polling until one settles or
 * the bound elapses. The engine (`onOpenAppVerified`) owns the MEANING of each category; this only decides when
 * the category has stopped moving enough to stop polling (so a legitimate `credential_issuance` landing no longer
 * spins the poll to the bound before the engine accepts it).
 */
function isVerifyResolved(category: ApiCenterPageCategory): boolean {
  return category === "app_detail" || category === "credential_issuance" || category === "login";
}

/**
 * The overlay step number per barrier (dev diagnostic badge only — cosmetic, mirrors the engine's plan).
 * Step 3 is the target-less usage-state advisory (no overlay), so the highlightable controls resume at step 4.
 */
const OVERLAY_STEP: Readonly<Record<IssuanceTarget, number>> = {
  create_app: 2,
  open_app: 2,
  api_group: 4,
  application_id: 5,
  application_secret: 6,
  return: 7,
};

/**
 * Operator-legible dev-overlay labels for the headed live run (no product FE is present, so the badge is the
 * only in-window guidance). Diagnostic aid only — NOT the product FE's localized copy. The SELLER performs
 * every step; SellerOps never copies the Client ID / Secret (a separate masked SellerOps form does that).
 */
/**
 * **Which walk this panel belongs to**, shown in the shared shell's header beside the step counter. The Coupang
 * walk names itself the same way on the same shell — a seller connecting both channels meets one product.
 */
const NAVER_CHANNEL_NAME = "네이버 커머스 API";

/**
 * **The panel's one visible line per step** — what to do now, on the window the seller is working in.
 *
 * These are SELLER copy, and they were not before. They said "SellerOps에서 '다음'을 누르세요" because the only
 * button that advanced a step was in the other tab: a walk whose every step ended with "now go to the other
 * window" is the round trip the WING walk removed and this one kept. The advance button is on this panel now,
 * so the copy names it.
 *
 * What has NOT changed is the boundary each line states: the seller creates the application, opens it, selects
 * the group and copies the two values. SellerOps highlights, observes a page transition, and reads nothing.
 */
const NAVER_STEP_BRIEF: Readonly<Record<IssuanceTarget, string>> = {
  create_app: "'애플리케이션 등록'을 직접 눌러 애플리케이션을 만드세요. 다 만드셨으면 아래 '다음'을 누르세요.",
  open_app: "연결할 애플리케이션을 직접 여세요. 상세 화면이 열리면 자동으로 넘어갑니다.",
  api_group: "표시된 '커머스 API' 그룹이 선택돼 있는지 확인하세요.",
  application_id: "표시된 애플리케이션 ID를 직접 복사해 두세요. SellerOps는 값을 읽지 않습니다.",
  application_secret: "'보기'를 눌러 시크릿을 확인하고 직접 복사해 두세요. SellerOps는 값을 읽지 않습니다.",
  return: "복사한 두 값을 SellerOps 창에 입력하면 연결이 끝납니다.",
};

/**
 * **The rest of each step, behind the panel's `자세히` disclosure.**
 *
 * These are the frontend's own step strings, VERBATIM — the same relationship the WING walk has
 * (`OPERATOR_STEP_LABELS` ↔ `frontend/src/lib/actionWindow/copy.ts`, asserted by a crossstack parity test), and
 * for the same reason: this copy carries safety claims the seller acts on ("SellerOps는 시크릿 값도, 클립보드도
 * 읽지 않습니다"), and two places wording one step is how one of them quietly loses a clause.
 *
 * They moved here rather than being rewritten because they were already the vetted seller copy. What changed is
 * WHERE the seller reads them: on the window they are working in, instead of the tab they had to go back to.
 */
export const NAVER_STEP_DETAIL: Readonly<Record<IssuanceTarget, string>> = {
  create_app:
    "새 애플리케이션을 하나 만드세요. 스토어당 애플리케이션은 1개만 만들 수 있고 삭제할 수 없으니, 이미 만든 앱이 있으면 새로 만들지 말고 그 앱을 사용하세요.",
  open_app:
    "이미 만들어 둔 애플리케이션의 상세 화면을 여세요. 새 애플리케이션을 만들지 마세요 — 스토어당 1개만 가능하고 삭제할 수 없습니다.",
  api_group:
    "이 애플리케이션에 상품·주문(판매자) 관련 API 그룹이 포함돼 있는지 확인하고, 없으면 추가하세요. 정확한 그룹 이름은 화면마다 다를 수 있으니 '주문'·'판매자'가 포함된 항목을 찾아 선택하면 됩니다.",
  application_id:
    "애플리케이션 ID를 복사해 주세요. 표시된 애플리케이션 ID 행에서 값을 직접 복사하시면 됩니다. SellerOps는 이 값을 읽지 않습니다 — 복사는 직접 하시고, 마지막에 SellerOps 보안 입력란에 붙여넣으세요.",
  application_secret:
    "애플리케이션 시크릿을 확인하고 복사해 주세요. 표시된 '보기/복사' 컨트롤에서 시크릿을 직접 확인·복사하시면 됩니다. SellerOps는 시크릿 값도, 클립보드도 읽지 않습니다. 확인이 어려우면 시크릿 재발급이 필요할 수 있습니다.",
  // **The honest ending, and it is deliberately different from the WING walk's.** Coupang shows the three
  // values on a page SellerOps can read under the seller's consent, so that walk ends with one press. NAVER
  // does not: the seller types the two values in themselves, and a panel that implied otherwise would be
  // promising a capability this channel does not have.
  return: "두 값을 복사했다면 SellerOps로 돌아가 주세요. 안내가 끝나면 연결 정보 입력 화면으로 이동합니다.",
};

/**
 * **Step 3, the text-only usage-state advisory — the one step with no control to ring.**
 *
 * It has no target, so nothing highlights and nothing mounted a panel for it: the instruction lived ONLY in the
 * SellerOps tab, and its button did too. Moving the other steps onto the API-centre window without moving this
 * one would have left exactly one step that still required going back — and, with the per-step control gone
 * from that screen, no way past it at all.
 *
 * Verbatim from the frontend's own copy, like {@link NAVER_STEP_DETAIL}, including the claim that matters most
 * here: SellerOps does not read the app's state and never asserts it is active.
 */
export const NAVER_APP_USAGE_COPY = Object.freeze({
  existing: {
    brief: "애플리케이션 상태를 확인해 주세요.",
    detail:
      "애플리케이션 상태를 확인해 주세요. 화면에 '다시사용' 버튼이 보인다면 직접 눌러 앱을 활성화해 주세요. 버튼이 보이지 않더라도 SellerOps가 활성 상태라고 단정하지 않습니다. 확인했다면 다음으로 진행해 주세요.",
    badge: "애플리케이션 상태 확인",
  },
  new: {
    brief: "방금 만든 애플리케이션의 상태를 확인해 주세요.",
    detail:
      "방금 만든 애플리케이션의 상태를 확인해 주세요. 새로 만든 앱은 보통 바로 사용할 수 있지만, 혹시 화면에 '다시사용' 버튼이 보이면 직접 눌러 활성화해 주세요. 버튼이 보이지 않더라도 SellerOps가 활성 상태라고 단정하지 않습니다. 확인했다면 다음으로 진행해 주세요.",
    badge: "생성 직후 상태 확인",
  },
});

/** The advisory's own latch token — its own namespace, like every other press in this walk. */
const APP_USAGE_ADVANCE_TOKEN = "naver-issuance-advance:app_usage_check";

/**
 * The panel's advance button per step. `open_app` has NONE: it is the one step that auto-advances on the
 * observed `app_list → app_detail` navigation, and a button beside an observation is a second way to claim a
 * thing the runtime is already measuring.
 */
const NAVER_ADVANCE_LABEL: Readonly<Partial<Record<IssuanceTarget, string>>> = {
  create_app: "만들었어요 · 다음",
  api_group: "확인했어요 · 다음",
  application_id: "복사했어요 · 다음",
  application_secret: "복사했어요 · 다음",
  return: "SellerOps에서 입력할게요 · 완료",
};

/** The chip above the ring: which step this is, never an abbreviated instruction (the panel carries that). */
export const NAVER_STEP_TITLE: Readonly<Record<IssuanceTarget, string>> = {
  create_app: "애플리케이션 만들기 (스토어당 1개)",
  open_app: "발급한 애플리케이션 열기",
  api_group: "주문·판매자 관련 API 그룹 추가",
  application_id: "애플리케이션 ID 복사",
  application_secret: "애플리케이션 시크릿 확인·복사",
  return: "SellerOps로 돌아와 입력",
};

/**
 * **What a parked NAVER walk says on the API-centre window**, and what a finished one does.
 *
 * Same rule as the WING walk's park notices: it says what SellerOps could not do and points at the seller's own
 * 다시 확인 — never at a NAVER control. `LOGIN_REQUIRED` is absent for the same reason there too: SellerOps does
 * not put a floating panel over a screen where someone is typing a password.
 */
const NAVER_PARK_NOTICE_COPY: Readonly<Record<NaverIssuanceParkNotice, { badge: string; brief: string; detail: string }>> =
  Object.freeze({
    TARGET_NOT_FOUND: {
      badge: "안내 멈춤",
      brief: "이 화면에서 다음 위치를 찾지 못했어요.",
      detail: "화면이 모두 뜬 뒤 SellerOps에서 '다시 확인'을 눌러 주세요.",
    },
    UI_DRIFT: {
      badge: "안내 멈춤",
      brief: "네이버 화면이 예상과 달라요.",
      detail: "연결할 애플리케이션의 상세 화면인지 확인한 뒤, SellerOps에서 '다시 확인'을 눌러 주세요.",
    },
  });

/**
 * The walk is over. Copy-only, and that is a decision rather than an omission: the WING walk's completion panel
 * carries a `SellerOps로 돌아가기` button because that carrier injects a real navigation. This one does not, and
 * a button that recorded a press and moved nothing is exactly the defect the WING walk had to fix on 2026-08-12.
 */
const NAVER_COMPLETION_COPY = Object.freeze({
  badge: "확인 완료",
  brief: "✓ 네이버 API 확인 완료",
  detail: "SellerOps 창으로 돌아가 애플리케이션 ID와 시크릿을 입력하면 연결이 끝납니다. 이 창은 닫으셔도 됩니다.",
});

/**
 * The opaque per-step latch token for this walk's panel advance button. Value-free — a fixed derived string,
 * compared only for equality. Distinct per target so a stale press cannot satisfy the next step's poll, and in
 * its own `naver-issuance` namespace so it can never collide with the WING walk's.
 */
function naverAdvanceToken(target: IssuanceTarget): string {
  return `naver-issuance-advance:${target}`;
}

/** A browser context whose newest tab may hold the step the seller opened. Structural subset of Playwright's. */
export interface IssuanceContextLike {
  pages(): Page[];
  on?(event: "close", handler: () => void): void;
}

export interface NaverIssuanceDriverOptions {
  /** Bounded window for the seller to act on a highlighted control. Defaults to {@link DEFAULT_ISSUANCE_OBSERVE_TIMEOUT_MS}. */
  observeTimeoutMs?: number;
  guidanceEnabled?: boolean;
  /**
   * Optional context so the driver reads the NEWEST tab: the seller may open the next API-center step in a new
   * tab (mirrors `observe-api-center`'s newest-tab handling). Absent → the single injected page is used.
   */
  context?: IssuanceContextLike;
  /** Pause between in-page locate/highlight retries. Defaults to {@link INPAGE_RETRY_MS}; tests set 0. */
  inpageRetryMs?: number;
  /** Pause between VERIFY_OPEN settle-polls. Defaults to {@link VERIFY_POLL_MS}; tests set 0. */
  verifyPollMs?: number;
}

/**
 * A FIXED, synthetic guidance signature for `return`. Returning to SellerOps is NOT a NAVER control — it is
 * text guidance — so this signature is NOT derived from any page element. It is a stable opaque 16-hex constant
 * so the engine's locate↔highlight anti-drift check (which requires the two signatures to match) still passes.
 */
const RETURN_GUIDANCE_SIG = "5e11e40b5e11e40b";

/**
 * A FIXED, synthetic guidance signature for `open_app`. Opening an existing application is NAVIGATION guidance,
 * not a highlighted NAVER control — so, like `return`, this signature is NOT derived from any page element. It
 * is a stable opaque 16-hex constant (distinct from {@link RETURN_GUIDANCE_SIG}) so the engine's locate↔highlight
 * anti-drift check still passes for the guidance overlay.
 */
const OPEN_APP_GUIDANCE_SIG = "09a90b1109a90b11";

/**
 * The value-free FIXED-LABEL locate/tag script for a highlightable target (the three label targets only). When
 * `tag` is true it also moves the read-only `data-aw-target` annotation onto the unique match. The script (in
 * `visual-recon-inpage`) returns only `{ count, sig? }` — never any text/value.
 */
function issuanceLocateScript(target: IssuanceHighlightTarget, tag: boolean): string {
  const loc = locatorFor(target);
  // `tagAncestor` (credentials → "tr") promotes the read-only tag from the label cell to its row; anti-drift sig
  // stays on the label. Only meaningful when tagging; harmless (unread) on a pure locate.
  return buildFixedLabelLocateScript({
    candidateQuery: loc.candidateQuery,
    exactText: loc.exactText,
    tag,
    tagAncestor: loc.tagAncestor,
  });
}

/**
 * The locate/tag script the GUIDED highlight walk may run for a target — null unless the target is
 * {@link isGuidedHighlightTarget} (a `live_confirmed`, calibrated control). Kept as a fail-closed gate so a
 * future non-calibrated highlight target parks `target_not_found` rather than being highlighted blind.
 */
function guidedLocateScript(target: IssuanceHighlightTarget, tag: boolean): string | null {
  return isGuidedHighlightTarget(target) ? issuanceLocateScript(target, tag) : null;
}

/** Remove every read-only `data-aw-target` annotation. Value-free; safe on a page with none. */
const IN_PAGE_CLEAR_TAG = `(function () {
  /* issuance-cleartag */
  var slice = Function.prototype.call.bind(Array.prototype.slice);
  var els = slice(document.querySelectorAll('[data-aw-target]'));
  for (var i = 0; i < els.length; i++) { els[i].removeAttribute('data-aw-target'); }
  return true;
})()`;

/** Count candidate application-entry rows — a COUNT only, never a name/id/value. */
const IN_PAGE_APP_ENTRY_COUNT = `(function () {
  /* issuance-appcount */
  return document.querySelectorAll(${JSON.stringify(CANDIDATE_APP_ENTRY_SELECTOR)}).length;
})()`;

export class NaverIssuanceDriver implements IssuanceProbeDriver {
  /** The step the walk was last guiding — so a park notice keeps its place in the walk. */
  private lastStepNumber = 1;
  private readonly page: Page;
  private readonly opts: NaverIssuanceDriverOptions;
  private readonly closed: Promise<void>;

  constructor(page: Page, opts: NaverIssuanceDriverOptions = {}) {
    this.page = page;
    this.opts = opts;
    // Resolve when the seller closes the API-center window (page or, if provided, the whole context), so the
    // session parks recoverably instead of arming an observation on a dead page.
    this.closed = new Promise<void>((resolve) => {
      let done = false;
      const fire = (): void => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      page.on("close", fire);
      opts.context?.on?.("close", fire);
    });
  }

  /** The page all surface work runs against: the newest tab when a context is injected, else the single page. */
  private activePage(): Page {
    const pages = this.opts.context?.pages() ?? [];
    return pages.length > 0 ? pages[pages.length - 1]! : this.page;
  }

  /** Evaluate a STRING snippet (not a function) so esbuild's `__name` shim is never referenced in the page. */
  private evalStr<R>(page: Page, script: string): Promise<R> {
    return (page as unknown as { evaluate<T>(s: string): Promise<T> }).evaluate<R>(script);
  }

  /** Best-effort settle; a page without `waitForLoadState` (offline fake) is left as-is. */
  private async settle(page: Page): Promise<void> {
    const p = page as unknown as { waitForLoadState?: (s: string, o?: { timeout?: number }) => Promise<void> };
    if (typeof p.waitForLoadState !== "function") return;
    try {
      await p.waitForLoadState("networkidle", { timeout: SETTLE_TIMEOUT_MS });
    } catch {
      /* timeout is fine — the classifier fails closed on thin signals */
    }
  }

  /**
   * Best-effort settle of the current surface before the engine's next locate. The session calls this at the top
   * of a `guide` so the fixed-label locate/highlight never fires on a still-settling post-navigation page (the
   * `app_list → app_detail` transition that destroyed the execution context in the live proof). Bounded and
   * value-free — it waits for `networkidle` only, reads nothing, and a page that never idles just proceeds and
   * fails closed downstream, exactly like {@link probeSurface}.
   */
  async settleSurface(): Promise<void> {
    await this.settle(this.activePage());
  }

  /**
   * **The SPA-stable resolution of a fixed-label highlight target — Playwright LOCATOR based, not `.evaluate`.**
   *
   * The live-proof failure was a raw `page.evaluate(querySelectorAll…)` throwing "execution context was destroyed"
   * on the NAVER app-detail SPA — a raw evaluate does not survive the SPA's client-side (soft) navigations. So the
   * SEARCH now runs through a Playwright locator, which auto-waits and RE-RESOLVES across those navigations:
   *   1. Build a locator narrowing the structural candidate query to the FIXED NAVER label (exact, whitespace-
   *      tolerant) and wait (bounded) for it to be ATTACHED — this is the primitive that rides out the soft-navs.
   *   2. Enforce UNIQUENESS with `locator.count()` (the calibrated targets are matchCount===1); anything else is a
   *      recoverable park upstream.
   *   3. `scrollIntoViewIfNeeded` (read-only; scrolling is not a click) so the section is on screen before tagging.
   *   4. ONLY THEN run the AUDITED value-free tag+sig IIFE ({@link buildFixedLabelLocateScript}) on the now-settled,
   *      unique, in-view element — wrapped in a small bounded retry for a soft-nav that lands mid-annotation. This
   *      keeps the value-free OUTPUT + exact-label match + structural anti-drift signature byte-for-byte unchanged.
   *
   * Re-reads {@link activePage} on every attempt so a context/frame change (a newly-opened tab) is picked up. On a
   * locator TIMEOUT it returns `{ count: 0 }` (→ `target_not_found` park, recoverable, bounded — never an infinite
   * wait); on a non-unique match `{ count }`; if the final annotation keeps throwing, the last error propagates and
   * the session's `onDriveError → engine.onDriveFault` parks `page_mismatch` recoverably.
   */
  private async resolveFixedLabelTarget(
    target: IssuanceHighlightTarget,
    tag: boolean,
    afterTag?: (page: Page) => Promise<void>,
  ): Promise<LocateResult> {
    const loc = locatorFor(target);
    const hasText = exactLabelRegex(loc.exactText);
    const script = guidedLocateScript(target, tag);
    if (!script) return { count: 0 }; // fail closed rather than resolve a non-calibrated control
    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_INPAGE_RETRIES; attempt++) {
      // Re-resolve the active page/frame each attempt so a context change (new tab) is followed, not stale-bound.
      const page = this.activePage();
      const located = page.locator(loc.candidateQuery, { hasText });
      // Stage telemetry (observation only — never alters control flow): the stage that is CURRENTLY executing, so
      // the catch can report the EXACT stage a fault came from. Advanced as each stage begins.
      let stage: IssuanceStage = "resolve";
      try {
        // Auto-waiting resolution that survives the SPA's soft-navigations (the actual live fix). EVERY locator op
        // (waitFor / count / scroll), the audited tag `.evaluate`, AND the overlay mount (afterTag) share this one
        // try, so a soft-nav that destroys the context under ANY of them is retried up to the bound rather than
        // escaping unbounded.
        stage = "resolve";
        await located.first().waitFor({ state: "attached", timeout: LOCATOR_TIMEOUT_MS });
        const matchCount = await located.count();
        if (matchCount !== 1) return { count: matchCount }; // non-unique → engine parks target_not_found (recoverable)
        // Read-only: bring the section into view (never a click) so the tag lands on an on-screen element. Scroll is
        // best-effort — a scroll timeout/miss must not fail the resolve, so it never reaches the catch below. But we
        // DO record a swallowed scroll fault (a live hypothesis is that this scroll triggers a re-render that then
        // destroys the context under the FOLLOWING tag): sanitized stage+name+reason only, no behaviour change.
        stage = "scroll";
        await located
          .first()
          .scrollIntoViewIfNeeded({ timeout: LOCATOR_TIMEOUT_MS })
          .catch((e) => {
            // A DISTINCT event (not `aw_issuance_stage_fault`) so counting terminal faults never conflates this
            // harmless-but-informative swallowed scroll error with an actual drive fault. The scroll stays
            // best-effort — this callback returns undefined, so the resolve is unaffected.
            log("aw_issuance_stage_scroll_swallowed", {
              target,
              stage: "scroll",
              attempt,
              errorName: errName(e),
              reason: classifyFaultReason(e),
            });
          });
        // The audited value-free tag+sig on the already-resolved unique element.
        stage = "tag";
        const res = await this.evalStr<LocateResult>(page, script);
        if (res.count !== 1 || !res.sig) {
          log("aw_issuance_stage_nonunique", { target, stage: "tag", count: res.count });
          return { count: res.count };
        }
        // ATOMIC tag → overlay mount, in the SAME try on the SAME re-resolved page: mounting the overlay reads the
        // `[data-aw-target]` this tag just set, so doing it here (not after resolve returns) means a soft-nav
        // between the tag and the mount destroys the context under the mount → this attempt retries and RE-TAGS +
        // RE-MOUNTS on the fresh context, instead of mounting against a stale/lost tag. This is the live fix for the
        // api_group overlay never rendering (the mount was the remaining un-retried `.evaluate`).
        if (afterTag) {
          stage = "mount";
          await afterTag(page);
          // VERIFY the overlay actually PAINTED. `mountOverlay` silently no-ops (`if(!target) return`) when the tag
          // was lost to a soft-nav between the tag and the mount — and the mount's own bounded retry can even
          // convert a context-destroyed throw INTO that silent no-op (its retry runs against a fresh context whose
          // DOM no longer carries `[data-aw-target]`). Without this check that reads back as a highlighted control
          // with NO overlay on screen — a fail-OPEN success, the exact bug this unit fixes. If it did not paint,
          // throw a retryable (non-timeout) error so THIS attempt's outer loop RE-TAGS + RE-MOUNTS on the current
          // context; on exhaustion it propagates → `onDriveFault` → recoverable page_mismatch (fail-closed).
          stage = "visible_check";
          if (!(await overlayMounted(page))) {
            throw new Error("overlay produced no painted overlay (tag lost to a soft-nav before mount)");
          }
        }
        // The whole attempt succeeded — record which stages ran so the diagnostic distinguishes a locate-only
        // resolve from a full tag→mount→paint. Sanitized: target enum + booleans only.
        log("aw_issuance_stage_ok", { target, attempt, tagged: tag, mounted: !!afterTag });
        return { count: 1, sig: res.sig };
      } catch (e) {
        // SANITIZED stage telemetry: the EXACT stage this attempt was in when it threw, the error NAME, and the
        // fixed reason enum — the evidence that pins the root cause in ONE gated live diagnostic. No message, value,
        // text, URL, or selector is emitted. This is pure observation; the control flow below is byte-unchanged.
        log("aw_issuance_stage_fault", {
          target,
          stage,
          attempt,
          errorName: errName(e),
          reason: classifyFaultReason(e),
          timeout: isTimeout(e),
        });
        // A locator TIMEOUT is a bounded miss (the label never rendered) → recoverable target_not_found, returned
        // WITHOUT retrying (retrying a timeout would just wait another full window). Any other error (a soft-nav
        // destroying the context under count/tag/mount) is retried up to the bound, then propagates → onDriveFault.
        if (isTimeout(e)) return { count: 0 };
        lastErr = e;
        if (attempt < MAX_INPAGE_RETRIES) await sleep(this.opts.inpageRetryMs ?? INPAGE_RETRY_MS);
      }
    }
    throw lastErr;
  }

  async probeSurface(): Promise<IssuanceSurfaceProbe> {
    await this.settle(this.activePage());
    return this.readSurface();
  }

  /**
   * Classify the CURRENT surface WITHOUT settling — the value-free census + host-category read that
   * {@link probeSurface} runs after its settle. Split out so VERIFY_OPEN's poll can re-read the category cheaply
   * between short delays: a settle waits `networkidle` up to {@link SETTLE_TIMEOUT_MS} (15 s), and running it on
   * every one of {@link VERIFY_MAX_POLLS} polls of a never-idle SPA would stall VERIFY for minutes. The poll
   * settles ONCE up front (via the first `probeSurface`) then quick-reads here.
   */
  private async readSurface(): Promise<IssuanceSurfaceProbe> {
    const page = this.activePage();
    const census = await this.evalStr<ApiCenterStructuralCensus>(page, EXTRACT_API_CENTER_CENSUS);
    // The raw URL is reduced to a host CATEGORY and never logged/emitted; only the enum is used.
    const urlCategory = classifyUrlCategory(page.url());
    const { pageCategory, signals } = pageCategoryFromCensus(urlCategory, census);
    if (pageCategory === "login") {
      log("aw_issuance_probe", { pageCategory, ok: false });
      return { ok: false, pageCategory: "login", blockerCode: "LOGIN_REQUIRED" };
    }
    log("aw_issuance_probe", { pageCategory, ok: true });
    return { ok: true, pageCategory, signals };
  }

  /**
   * VERIFY_OPEN's bounded-polling probe: after the seller opens their existing app the app-detail SPA hydrates for
   * a beat and can classify as a transient `unknown` (or briefly still `app_list`) before it settles. Rather than
   * fail the verify on that first transient read (the live-proof flake), poll {@link probeSurface} up to
   * {@link VERIFY_MAX_POLLS} times ({@link VERIFY_POLL_MS} apart) and return as soon as a DEFINITIVE landing is
   * reached — `app_detail` (success) or `login` (session lost, recoverable). If it never settles within the bound,
   * return the LAST probe unchanged: the engine then parks `page_mismatch` recoverably. Value-free and bounded — no
   * wall-clock read, only the sanitized category, and it can never wait forever.
   */
  async probeSurfaceSettled(): Promise<IssuanceSurfaceProbe> {
    const pollMs = this.opts.verifyPollMs ?? VERIFY_POLL_MS;
    // Settle ONCE up front (give the just-started navigation a beat), then quick-read the category between short
    // delays — NOT a full 15 s settle per poll, which would stall VERIFY for minutes on a never-idle SPA.
    let last = await this.probeSurface();
    for (let i = 1; i < VERIFY_MAX_POLLS && !isVerifyResolved(last.pageCategory); i++) {
      if (pollMs > 0) await sleep(pollMs); // pollMs 0 (tests) stays microtask-only; live waits a real beat
      last = await this.readSurface();
    }
    return last;
  }

  async readApplications(): Promise<ApplicationsRead> {
    const page = this.activePage();
    const census = await this.evalStr<ApiCenterStructuralCensus>(page, EXTRACT_API_CENTER_CENSUS);
    // CANDIDATE / LIVE_DOM_CALIBRATION_PENDING: a COUNT of application-entry rows — never a name/id/value.
    const applicationEntryRowCount = await this.evalStr<number>(page, IN_PAGE_APP_ENTRY_COUNT);
    log("aw_issuance_read_apps", { hasEntries: applicationEntryRowCount > 0 });
    return { census, applicationEntryRowCount };
  }

  async locateTarget(target: IssuanceTarget): Promise<LocateResult> {
    // `return` and `open_app` are GUIDANCE, not queried NAVER controls — each resolves to a fixed synthetic
    // signature (return = "go back to SellerOps"; open_app = "open your existing app yourself" — the driver
    // then OBSERVES the app_detail navigation, it never highlights a specific app row).
    if (target === "return") return { count: 1, sig: RETURN_GUIDANCE_SIG };
    if (target === "open_app") return { count: 1, sig: OPEN_APP_GUIDANCE_SIG };
    // Only the fixed-label controls are highlightable.
    if (!isIssuanceHighlightTarget(target)) return { count: 0 };
    // SPA-stable: the search is Playwright-locator based (auto-waiting, survives soft-navs), not a raw `.evaluate`.
    return this.resolveFixedLabelTarget(target, false);
  }

  async highlightTarget(target: IssuanceTarget): Promise<LocateResult> {
    const page = this.activePage();
    // `return` and `open_app` show a GUIDANCE overlay — no NAVER control is located/tagged for either. For
    // open_app the overlay tells the seller to open their app; the app_detail transition is observed next.
    if (target === "return") {
      await this.mountStepOverlay(page, "return");
      return { count: 1, sig: RETURN_GUIDANCE_SIG };
    }
    if (target === "open_app") {
      /**
       * **The DOCKED panel, and a paint check — `open_app` has no anchor to ring.**
       *
       * `open_app` is deliberately not a highlight target: a live row anchor measured 44 matches, so the step
       * is guidance ("발급한 애플리케이션 열기") plus an observed page transition, and nothing here tags an
       * element. That is exactly the case `mountOverlay` returns from without painting —
       * `if (!target && !o.dockedPanelOnly) return;` — so this call created NOTHING, silently, on the FIRST
       * guided step of the walk. Live 2026-08-19: the API-center window opened, the app list was read
       * (`aw_issuance_probe pageCategory=app_list`, `aw_issuance_read_apps hasEntries=true`), and the seller
       * saw no overlay at all for the whole walk.
       *
       * The Coupang driver already hit and fixed this on its own text-guided steps, and its comment is the
       * specification: *"the panel ALONE, docked. Without `dockedPanelOnly` the mount finds no anchor and
       * returns having created nothing, which is why these steps had no presentation of their own."* This is
       * that fix applied to the sibling it was never carried to.
       *
       * Three parts, in the order the Coupang path established:
       *  - **clear the prior tag first** — a step that claims no locator must leave no anchor behind, or the
       *    mount finds the PREVIOUS step's `data-aw-target` and rings a control this step is not about;
       *  - **mount docked**, so the panel is its own presentation;
       *  - **verify it painted**, so a lost context reads as `count: 0` (→ recoverable park) instead of a
       *    fail-OPEN "highlighted" with nothing on screen — the same asymmetry `resolveFixedLabelTarget`'s
       *    `visible_check` stage enforces for the anchored targets.
       */
      await this.evalStr(page, IN_PAGE_CLEAR_TAG).catch(() => undefined);
      await this.mountStepOverlay(page, "open_app", true);
      return (await overlayMounted(page)) ? { count: 1, sig: OPEN_APP_GUIDANCE_SIG } : { count: 0 };
    }
    if (!isIssuanceHighlightTarget(target)) return { count: 0 };
    // Anti-drift + SPA-safe mount: the locator RE-resolves the unique match (surviving soft-navs) and scrolls it
    // into view, then the audited script RE-tags + re-signs it, and — in the SAME retried attempt — the overlay is
    // mounted on that fresh tag (see `resolveFixedLabelTarget`'s `afterTag`). Mounting the reused overlay SCROLLS
    // the tagged section into the viewport centre (see `overlay.ts`) and shows the "여기입니다" pointer, so the
    // operator sees where the API group / Application ID is with no NAVER click awaited (`REVEAL_SECTION_IN_VIEWPORT`).
    // The engine still compares this sig against the locate sig and parks page_mismatch if the match drifted.
    const res = await this.resolveFixedLabelTarget(target, true, (activePage) => this.mountStepOverlay(activePage, target));
    return { count: res.count, ...(res.count === 1 && res.sig ? { sig: res.sig } : {}) };
  }

  /**
   * Mount the reused read-only step overlay for one target's operator-legible dev badge. Never clicks/types.
   *
   * OBSERVATION SEAM (Overlay Mount Fault Identification): the `Overlay Root-Cause Isolation` unit pinned the
   * live highlight fault to the `mount` stage with `reason=OTHER`, but not to WHICH internal step of the mount.
   * So on a mount throw we localize it — read the in-page sub-stage breadcrumb ({@link readMountSubStage}) and
   * CODE-FINGERPRINT the error ({@link fingerprintMountFault}) — log the sanitized `{subStage, reason, errorName}`
   * (adding a scrubbed `message` ONLY when the fingerprint is `UNKNOWN`), then RE-THROW the SAME error. Control
   * flow is byte-identical: the identical error still propagates, so `resolveFixedLabelTarget`'s `mount`-stage
   * catch and every downstream recovery path behave exactly as before — this only observes on the way out.
   */
  private async mountStepOverlay(page: Page, target: IssuanceTarget, dockedPanelOnly = false): Promise<void> {
    // Remembered for the park notice: a park keeps the walk's own step number rather than resetting the counter
    // to 1, which would read as the run having started over.
    this.lastStepNumber = OVERLAY_STEP[target];
    const buttonLabel = NAVER_ADVANCE_LABEL[target];
    try {
      await mountOverlay(page, {
        // Set only for a step with no anchor to ring; without it the mount finds no target and paints nothing.
        ...(dockedPanelOnly ? { dockedPanelOnly: true } : {}),
        stepNumber: OVERLAY_STEP[target],
        totalSteps: ISSUANCE_TOTAL_STEPS,
        copyKey: `actionWindow.issuance.step.${target}`,
        // The BRIEF leads and the full copy sits behind the panel's disclosure — the same split the WING walk
        // uses, so a step that must be READ is not five sentences docked over the seller's work.
        label: NAVER_STEP_BRIEF[target],
        detail: NAVER_STEP_DETAIL[target],
        badgeLabel: NAVER_STEP_TITLE[target],
        guidanceEnabled: this.opts.guidanceEnabled ?? true,
        // The shared guided panel shell: the seller reads the step and advances it ON the window they are
        // working in. This walk used to say "SellerOps에서 '다음'을 누르세요" at every step — a round trip per
        // step, on the only walk that still had one.
        residentPanel: true,
        channelName: NAVER_CHANNEL_NAME,
        ...(buttonLabel ? { advance: { buttonLabel, token: naverAdvanceToken(target) } } : {}),
      });
    } catch (e) {
      // Localize the mount fault to a sub-stage + fixed reason (both sanitized) — the evidence the next unit needs.
      // The breadcrumb read is best-effort: if the very fault destroyed the context, it reads back `unknown`.
      const subStage = await readMountSubStage(page).catch(() => "unknown" as MountSubStage);
      const reason = fingerprintMountFault(e);
      log("aw_issuance_mount_substage_fault", {
        target,
        subStage,
        reason,
        errorName: errName(e),
        // A scrubbed FRAMEWORK message (never page content) ONLY for a cause with no known fingerprint — the exact
        // case the one gated live diagnostic must reveal. A recognized cause rides out as the fixed enum alone.
        ...(reason === "UNKNOWN" ? { message: sanitizeMountMessage(e) } : {}),
      });
      throw e; // re-throw the SAME error — control flow unchanged for every caller
    }
  }

  /**
   * Re-arm this step's on-page advance latch, so a press left over from an earlier step (or an earlier arm
   * window) can never be misread as this step's. Value-free: it writes an opaque token and drops a latch.
   */
  async armPanelAdvance(target: IssuanceTarget): Promise<void> {
    if (!NAVER_ADVANCE_LABEL[target]) return;
    await resetOverlayAdvance(this.activePage(), naverAdvanceToken(target)).catch(() => undefined);
  }

  /** Did the seller press THIS step's panel button? Value-free equality poll; an unreadable page ⇒ `false`. */
  async readPanelAdvance(target: IssuanceTarget): Promise<boolean> {
    if (!NAVER_ADVANCE_LABEL[target]) return false;
    return readOverlayAdvancePressed(this.activePage(), naverAdvanceToken(target)).catch(() => false);
  }

  /**
   * **What the seller sees on the API centre while the run is parked.** A docked panel and nothing else: the
   * ring is cleared first, there is no button, and the copy names no NAVER control.
   *
   * The paint is VERIFIED before it is reported — a notice that claims to be on screen when it is not leaves
   * the seller exactly where this method exists to stop leaving them.
   */
  async showParkNotice(code: NaverIssuanceParkNotice): Promise<boolean> {
    const copy = NAVER_PARK_NOTICE_COPY[code];
    const page = this.activePage();
    await this.evalStr(page, IN_PAGE_CLEAR_TAG).catch(() => undefined);
    await mountOverlay(page, {
      dockedPanelOnly: true,
      stepNumber: this.lastStepNumber,
      totalSteps: ISSUANCE_TOTAL_STEPS,
      copyKey: `actionWindow.issuance.park.${code}`,
      label: copy.brief,
      detail: copy.detail,
      badgeLabel: copy.badge,
      guidanceEnabled: this.opts.guidanceEnabled ?? true,
      residentPanel: true,
      channelName: NAVER_CHANNEL_NAME,
    }).catch(() => undefined);
    return overlayMounted(page).catch(() => false);
  }

  /**
   * **Step 3's panel — the advisory with no control to ring.**
   *
   * Docked (there is nothing to point at) and it DOES carry a button, unlike a park notice: this step asks the
   * seller to check something and say they did, which is exactly what a barrier is. The press means what the
   * SellerOps "다음" meant, and the runtime still asserts nothing about the app's state.
   */
  async showAppUsageNotice(branch: "existing" | "new"): Promise<boolean> {
    const copy = NAVER_APP_USAGE_COPY[branch];
    const page = this.activePage();
    await this.evalStr(page, IN_PAGE_CLEAR_TAG).catch(() => undefined);
    await resetOverlayAdvance(page, APP_USAGE_ADVANCE_TOKEN).catch(() => undefined);
    await mountOverlay(page, {
      dockedPanelOnly: true,
      stepNumber: 3,
      totalSteps: ISSUANCE_TOTAL_STEPS,
      copyKey: "actionWindow.issuance.appUsageCheck",
      label: copy.brief,
      detail: copy.detail,
      detailExpanded: true,
      badgeLabel: copy.badge,
      guidanceEnabled: this.opts.guidanceEnabled ?? true,
      residentPanel: true,
      channelName: NAVER_CHANNEL_NAME,
      advance: { buttonLabel: "확인했어요 · 다음", token: APP_USAGE_ADVANCE_TOKEN },
    }).catch(() => undefined);
    this.lastStepNumber = 3;
    return overlayMounted(page).catch(() => false);
  }

  /** Has the seller pressed the advisory's button? Value-free equality poll; an unreadable page ⇒ `false`. */
  async readAppUsageAdvance(): Promise<boolean> {
    return readOverlayAdvancePressed(this.activePage(), APP_USAGE_ADVANCE_TOKEN).catch(() => false);
  }

  /** The walk is done. Copy-only — see {@link NAVER_COMPLETION_COPY} for why there is no button here. */
  async showCompletionNotice(): Promise<boolean> {
    const page = this.activePage();
    await this.evalStr(page, IN_PAGE_CLEAR_TAG).catch(() => undefined);
    await mountOverlay(page, {
      dockedPanelOnly: true,
      stepNumber: ISSUANCE_TOTAL_STEPS,
      totalSteps: ISSUANCE_TOTAL_STEPS,
      copyKey: "actionWindow.issuance.complete",
      label: NAVER_COMPLETION_COPY.brief,
      detail: NAVER_COMPLETION_COPY.detail,
      badgeLabel: NAVER_COMPLETION_COPY.badge,
      guidanceEnabled: this.opts.guidanceEnabled ?? true,
      residentPanel: true,
      channelName: NAVER_CHANNEL_NAME,
    }).catch(() => undefined);
    return overlayMounted(page).catch(() => false);
  }

  async clearHighlight(): Promise<void> {
    const page = this.activePage();
    await unmountOverlay(page).catch(() => undefined);
    await this.evalStr(page, IN_PAGE_CLEAR_TAG).catch(() => undefined);
  }

  async armObserve(_target: IssuanceTarget): Promise<void> {
    // No click observer is EVER armed for issuance now. The only observed target — `open_app` — is watched as a
    // page CATEGORY transition (see `observeUserAction` → `observeLeftApplicationsList`), not as a click on a
    // tagged control; the same-page viewport checkpoints (api_group / credentials / create_app / return) advance
    // on the operator's own SellerOps "다음", never on a NAVER click. So arming observation is a deliberate no-op.
    return;
  }

  async observeUserAction(target: IssuanceTarget): Promise<boolean> {
    // `open_app` is the ONE observed target: it completes when the seller navigates from the applications list
    // into the app detail — an OBSERVED page-category transition, not a click on a tagged control. The engine
    // then re-probes (VERIFY_OPEN) and verifies the landing page is app_detail before the same-page checkpoints.
    if (isIssuanceNavigationTarget(target)) return this.observeLeftApplicationsList();
    // Every other target is a same-page viewport checkpoint (or `return` guidance): SellerOps never waits for a
    // NAVER action on it — the operator advances with "다음" — so this is never armed for them. Return true as a
    // safe default should it ever be called, so no barrier can hang.
    return true;
  }

  /**
   * Observe the seller's own `app_list → app_detail` navigation for `open_app`, value-free: it polls the
   * sanitized page CATEGORY (the same census + host-category read `probeSurface` uses) and resolves `true` the
   * moment the page is no longer the applications list — i.e. the seller opened their app themselves. It NEVER
   * clicks, tags, or reads a value; only a coarse category enum is inspected, never a URL/DOM value. On timeout
   * (still on the list — the seller has not acted yet) it returns `false` so the session re-arms; the engine's
   * app_detail VERIFICATION (not this method) decides whether the landing page is correct.
   */
  private async observeLeftApplicationsList(): Promise<boolean> {
    const timeoutMs = this.opts.observeTimeoutMs ?? DEFAULT_ISSUANCE_OBSERVE_TIMEOUT_MS;
    const maxPolls = Math.max(1, Math.ceil(timeoutMs / OPEN_NAV_POLL_MS));
    for (let i = 0; i < maxPolls; i++) {
      // A census read can reject while the page is mid-navigation — treat that as "still navigating" and keep
      // polling rather than failing the barrier; the engine's VERIFY_OPEN re-probe is the authority afterwards.
      const category = await this.readPageCategory(this.activePage()).catch(() => "app_list" as ApiCenterPageCategory);
      if (category !== "app_list") return true; // the seller navigated off the applications list
      if (i < maxPolls - 1) await sleep(OPEN_NAV_POLL_MS);
    }
    return false; // still on the list — not acted yet; the session re-arms a fresh observation window
  }

  /** The sanitized page CATEGORY of a page (census + host-category only — never a URL or DOM value). */
  private async readPageCategory(page: Page): Promise<ApiCenterPageCategory> {
    const census = await this.evalStr<ApiCenterStructuralCensus>(page, EXTRACT_API_CENTER_CENSUS);
    const urlCategory = classifyUrlCategory(page.url());
    return pageCategoryFromCensus(urlCategory, census).pageCategory;
  }

  /**
   * READ-ONLY: measure how many candidates a highlight target's fixed-label locator matches on the CURRENT page,
   * and whether it resolves uniquely (matchCount===1). Value-free — it runs the locate script WITHOUT tagging (no
   * `data-aw-target` write) and mounts NO overlay, so it never mutates the page, clicks, types, or reads a value.
   * This is what the read-only `API_ISSUANCE_SELECTOR_PROBE` phase calls to confirm the driver's own mechanism.
   * (`open_app` is not a highlight target — it is navigation guidance — so it is never probed here.)
   */
  async probeTargetMatch(target: IssuanceHighlightTarget): Promise<{ matchCount: number; canHighlight: boolean }> {
    const script = issuanceLocateScript(target, false);
    const res = await this.evalStr<LocateResult>(this.activePage(), script);
    const matchCount = typeof res?.count === "number" && res.count >= 0 ? res.count : 0;
    return { matchCount, canHighlight: matchCount === 1 };
  }

  async cleanup(): Promise<void> {
    const page = this.activePage();
    await unmountOverlay(page).catch(() => undefined);
    await disarmObserver(page).catch(() => undefined);
    await this.evalStr(page, IN_PAGE_CLEAR_TAG).catch(() => undefined);
  }

  whenSurfaceClosed(): Promise<void> {
    return this.closed;
  }
}
