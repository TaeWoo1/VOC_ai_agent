/**
 * **NAVER-shaped synthetic review-export fixture (R4 pilot adapter, fixture-only).**
 *
 * A pure DATA fixture — no browser, no scripts, no timers. It models the LOGICAL shape of the
 * seller-center review-export surface the pilot adapter must handle (a review-management page with
 * a results area and a single visible+enabled export control), plus the hostile shapes the loop
 * must fail closed on. It contains NO real marketplace page content: no platform/brand token, no
 * real store name, no account identity, no URL, no downloaded content — an offline test asserts the
 * fixture itself is free of platform tokens.
 *
 * CANARIES: the page deliberately plants clearly-synthetic store-like / account-like / export-
 * filename-like strings ({@link NAVER_FIXTURE_CANARIES}). They exist so the privacy tests can prove
 * hostile page content NEVER crosses the wire, the persisted store, or driver outputs — only opaque
 * 16-hex refs and sanitized enums do.
 *
 * The user's platform action is modeled by {@link NaverReviewExportSurfaceFixture.applyUserAction}
 * — called by TEST code only, mirroring the browser fixture's real-click state flip. The Runtime
 * never calls it: it only observes the reported action and re-reads the fixture state.
 */
import type { SessionVerdictInput } from "../naver/session-verdict";

export type NaverFixtureMode =
  | "normal"
  | "no-target"
  | "multi-target"
  | "drift"
  | "unchanged"
  | "reconnect-required"
  | "login-required"
  | "empty-target"
  | "ambiguous-readiness"
  | "async-affordance";

/**
 * The artifact shape the user's action produces (downstream slice): a structurally valid
 * OOXML/xlsx-shaped payload, a wrong-extension artifact, an xlsx-named payload without the OOXML
 * magic, or no download at all (the timeout shape — absence models elapsed time offline).
 */
export type NaverFixtureDownloadShape = "xlsx-valid" | "wrong-extension" | "bad-magic" | "none";

/**
 * Minimal byte-carrying synthetic download — deliberately NO save capability (the fixture stays a
 * pure data object; only the quarantine module persists anything, via its injectable io).
 */
export interface NaverFixtureDownload {
  suggestedFilename(): string;
  bytes(): Uint8Array;
}

/**
 * Clearly-synthetic hostile strings planted in every fixture page. Privacy tests assert none of
 * them ever appears in a wire frame, persisted record, or driver output.
 */
export const NAVER_FIXTURE_CANARIES: readonly string[] = [
  "가상상점몰", // store-like display label
  "seller-fx-0000", // account-id-like token
  "리뷰내보내기_0000.xlsx", // export-filename-like pattern
];

/** The single expected export control. Generic export wording only — no platform token. */
const EXPORT_CONTROL = `<button id="fx-export-control">엑셀다운로드</button>`;
/** A second identical-wording control — the ambiguous many-targets shape. */
const EXPORT_CONTROL_SECOND = `<button id="fx-export-control-b">리뷰 엑셀다운로드</button>`;
/** The drifted replacement: same page, different control identity (id/wording changed). */
const EXPORT_CONTROL_DRIFTED = `<button id="fx-export-control-v2">내려받기</button>`;

/** A populated synthetic results table (rows are generic placeholders, never review content). */
const REVIEW_ROWS = `<table><tbody>
  <tr><td>합성 행 A</td><td>★★★★☆ (합성)</td></tr>
  <tr><td>합성 행 B</td><td>★★★☆☆ (합성)</td></tr>
</tbody></table>`;
/** A results container that is present but has ZERO data rows (the benign empty-target shape). */
const EMPTY_RESULTS = `<table><tbody></tbody></table>`;

const BYTE_ENCODER = new TextEncoder();

/** ZIP local-file-header magic + minimal header tail — the OOXML structural prefix. */
const ZIP_MAGIC_PREFIX = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]);

/**
 * Structurally OOXML-shaped synthetic bytes: the ZIP magic, the content-types entry name, and the
 * planted canaries — so the content-leak proof covers the artifact BYTES, not just page text. This
 * is not a real workbook; only the sniffed structural prefix matters.
 */
function xlsxShapedBytes(): Uint8Array {
  const tail = BYTE_ENCODER.encode(
    `[Content_Types].xml (합성 픽스처) ${NAVER_FIXTURE_CANARIES[0]} ${NAVER_FIXTURE_CANARIES[1]} ${NAVER_FIXTURE_CANARIES[2]}`,
  );
  const out = new Uint8Array(ZIP_MAGIC_PREFIX.length + tail.length);
  out.set(ZIP_MAGIC_PREFIX, 0);
  out.set(tail, ZIP_MAGIC_PREFIX.length);
  return out;
}

/** Hostile payload: xlsx-named but structurally NOT OOXML (an error-page-like body, canaried). */
function badMagicBytes(): Uint8Array {
  return BYTE_ENCODER.encode(
    `<html><body>오류 안내 (합성) ${NAVER_FIXTURE_CANARIES[0]} ${NAVER_FIXTURE_CANARIES[1]} ${NAVER_FIXTURE_CANARIES[2]}</body></html>`,
  );
}

function downloadFor(shape: NaverFixtureDownloadShape): NaverFixtureDownload | null {
  switch (shape) {
    case "xlsx-valid":
      // The suggested filename is the planted export-filename canary — proving it never leaks.
      return { suggestedFilename: () => NAVER_FIXTURE_CANARIES[2]!, bytes: xlsxShapedBytes };
    case "wrong-extension":
      return { suggestedFilename: () => "리뷰내보내기_0000.html", bytes: xlsxShapedBytes };
    case "bad-magic":
      return { suggestedFilename: () => NAVER_FIXTURE_CANARIES[2]!, bytes: badMagicBytes };
    case "none":
      return null;
  }
}

/** Generic page frame. Every page carries the canaries so leak tests cover all modes. */
function surfacePage(main: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <h1>리뷰 관리 (합성 픽스처)</h1>
    <p>상점 표시명: ${NAVER_FIXTURE_CANARIES[0]}</p>
    <p>계정 표시: ${NAVER_FIXTURE_CANARIES[1]}</p>
    <p>최근 내보내기 파일 표기(합성): ${NAVER_FIXTURE_CANARIES[2]}</p>
    <main>${main}</main>
  </body></html>`;
}

const LOGGED_IN_SIGNALS: SessionVerdictInput = {
  isSellerCenterUrl: true,
  passwordFieldPresent: false,
  authChallengePresent: false,
  menuOrGnbPresent: true,
  logoutAffordancePresent: true,
  exportCandidatesPresent: true,
  accountReconnectAffordancePresent: false,
};

/**
 * The NAVER-shaped synthetic review-export surface. `html()` returns the CURRENT state of the
 * surface; `applyUserAction()` (test-only) transitions it exactly as the user's real platform click
 * would — in `drift` mode the transition also replaces the target's identity, and in `unchanged`
 * mode the expected completion signal never appears.
 */
export class NaverReviewExportSurfaceFixture {
  readonly mode: NaverFixtureMode;
  readonly downloadShape: NaverFixtureDownloadShape;
  private acted = false;
  private pendingDownload: NaverFixtureDownload | null = null;

  constructor(mode: NaverFixtureMode, downloadShape: NaverFixtureDownloadShape = "xlsx-valid") {
    this.mode = mode;
    this.downloadShape = downloadShape;
  }

  /** Coarse, already-sanitized session signals (what the real adapter derives from its probes). */
  sessionSignals(): SessionVerdictInput {
    switch (this.mode) {
      case "reconnect-required":
        // Mirrors the live Run-1 finding: an account-continuation card ABOVE an alternate login
        // form — the password field is present but the reconnect affordance must win.
        return {
          isSellerCenterUrl: false,
          passwordFieldPresent: true,
          authChallengePresent: false,
          menuOrGnbPresent: false,
          logoutAffordancePresent: false,
          exportCandidatesPresent: false,
          accountReconnectAffordancePresent: true,
        };
      case "login-required":
        return {
          isSellerCenterUrl: false,
          passwordFieldPresent: true,
          authChallengePresent: false,
          menuOrGnbPresent: false,
          logoutAffordancePresent: false,
          exportCandidatesPresent: false,
          accountReconnectAffordancePresent: false,
        };
      case "no-target":
        return { ...LOGGED_IN_SIGNALS, exportCandidatesPresent: false };
      default:
        return { ...LOGGED_IN_SIGNALS };
    }
  }

  /** The surface HTML in its CURRENT state (pre-action, or post-action after applyUserAction). */
  html(): string {
    switch (this.mode) {
      case "normal":
      case "unchanged":
        return surfacePage(`${REVIEW_ROWS}${EXPORT_CONTROL}`);
      case "drift":
        // The user's action replaces the control identity — the post-action re-locate must drift.
        return surfacePage(`${REVIEW_ROWS}${this.acted ? EXPORT_CONTROL_DRIFTED : EXPORT_CONTROL}`);
      case "no-target":
        return surfacePage(`${REVIEW_ROWS}<p>내보내기 도구 미제공 (합성)</p>`);
      case "multi-target":
        return surfacePage(`${REVIEW_ROWS}${EXPORT_CONTROL}${EXPORT_CONTROL_SECOND}`);
      case "empty-target":
        // A visible+enabled control over ZERO exportable rows — the live false-alert shape.
        return surfacePage(`${EMPTY_RESULTS}${EXPORT_CONTROL}`);
      case "ambiguous-readiness":
        // No results container, no count, no emptiness marker (SPA-like) — must halt, never guess.
        return surfacePage(`<div>목록 영역 (합성, 지연 렌더)</div>${EXPORT_CONTROL}`);
      case "async-affordance":
        // An async job/download-list affordance wins over the direct control — not the supported
        // user-direct sync surface.
        return surfacePage(`${REVIEW_ROWS}<span>다운로드 목록 (합성)</span>${EXPORT_CONTROL}`);
      case "reconnect-required":
        return surfacePage(`<section><p>계속 진행하려면 계정 연결 확인 필요 (합성)</p></section>`);
      case "login-required":
        return surfacePage(`<form><input type="password" value=""></form>`);
    }
  }

  /**
   * TEST-ONLY: the USER's real platform action (never performed by the Runtime). Flips the surface
   * into its post-action state, exactly as the browser fixture's click handler does, and (per the
   * download shape) makes the resulting artifact available — RE-SET on every action, so a
   * resume-through-checkpoint retry produces a fresh one.
   */
  applyUserAction(): void {
    this.acted = true;
    this.pendingDownload = downloadFor(this.downloadShape);
  }

  /**
   * Consume the pending artifact the user's action produced (the driver's detect stage). `null`
   * models the no-download timeout shape — offline, absence stands in for elapsed time.
   */
  takePendingDownload(): NaverFixtureDownload | null {
    const pending = this.pendingDownload;
    this.pendingDownload = null;
    return pending;
  }

  hasActed(): boolean {
    return this.acted;
  }

  /** The expected post-action completion signal. Never present in `unchanged` mode. */
  completionSignalPresent(): boolean {
    return this.acted && this.mode !== "unchanged";
  }
}
