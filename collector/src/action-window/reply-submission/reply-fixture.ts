/**
 * **Reply-submission synthetic fixture (ISOLATED, offline).**
 *
 * A PURE DATA fixture modeling the NAVER reply composer surface — no browser, no scripts, no timers.
 * It carries HOSTILE content (canaries: a fake reply body, PII-shaped strings, a selector) precisely
 * so the no-leak tests can prove none of it ever crosses the sanitized contract boundary. A fixture
 * driver composes the pure {@link replyComposerLocateDecision} over these signals, so the synthetic
 * ladder (rung 1) exercises the same decision the live driver will.
 */
import { replyComposerLocateDecision, reviewRowLocateDecision } from "./reply-surface";
import type { RecencyBucket, ReplyTargetHint, ReviewRowSignal } from "./reply-surface";
import type { ReplySubmitProbeDriver } from "./reply-driver";
import type { LocateComposerResult, LocateRowResult, SurfaceProbeResult } from "./reply-engine";

/** Hostile strings that must NEVER appear in any emitted event/view/ack. */
export const REPLY_FIXTURE_CANARIES: readonly string[] = [
  "고객님 배송이 늦어 죄송합니다 — 합성 답변 본문",
  "010-1234-5678",
  "#reply-composer-textarea",
  "https://sell.smartstore.naver.com/reply",
  // Guided review-row canaries — a RAW timestamp (proving recency is bucketed, never a raw date) and a
  // RAW product name (proving page product text is never emitted; productName is not even a match key).
  "2026-07-14 09:31:22 KST — 원본 타임스탬프",
  "무선 이어폰 프로 (합성 상품명)",
];

export type ReplyFixtureMode =
  | "composer-present"
  | "composer-missing"
  | "composer-ambiguous"
  | "login-required"
  | "submitted"
  | "rows-present"
  | "rows-ambiguous"
  | "rows-missing"
  | "rows-drift";

/** The privacy-safe hint the row fixtures are built to match. */
export const REPLY_FIXTURE_HINT: ReplyTargetHint = {
  rating: 2,
  recencyBucket: "THIS_WEEK",
  bodyFingerprint: "fp_match_0001",
};

interface FixtureShape {
  surface: SurfaceProbeResult;
  candidateCount: number;
  /** Structural, non-reversible signature parts — deliberately NOT the canary content. */
  signatureParts?: readonly (string | number)[];
}

function shapeFor(mode: ReplyFixtureMode): FixtureShape {
  switch (mode) {
    case "composer-present":
    case "submitted":
      return { surface: true, candidateCount: 1, signatureParts: ["composer", "role:textbox", 1] };
    case "composer-missing":
      return { surface: true, candidateCount: 0 };
    case "composer-ambiguous":
      return { surface: true, candidateCount: 2, signatureParts: ["composer", "role:textbox", 2] };
    case "login-required":
      return { surface: { ok: false, code: "LOGIN_REQUIRED" }, candidateCount: 0 };
    // Row modes reach the composer surface true; the composer itself is present in the matching row.
    case "rows-present":
    case "rows-ambiguous":
    case "rows-missing":
    case "rows-drift":
      return { surface: true, candidateCount: 1, signatureParts: ["composer", "role:textbox", 1] };
  }
}

/** The pure locate decision for a mode — what the fixture driver and any test would compute. */
export function fixtureLocateDecision(mode: ReplyFixtureMode): LocateComposerResult {
  const shape = shapeFor(mode);
  return replyComposerLocateDecision({
    composerCandidateCount: shape.candidateCount,
    composerSignatureParts: shape.signatureParts,
  });
}

/* ────────────────────────── Guided review-row fixture data ────────────────────────── */

const NON_MATCH_A: ReviewRowSignal = { rating: 5, recencyBucket: "OLDER" as RecencyBucket, bodyFingerprint: "fp_other_a" };
const NON_MATCH_B: ReviewRowSignal = { rating: 3, recencyBucket: "TODAY" as RecencyBucket, bodyFingerprint: "fp_other_b" };
const MATCH: ReviewRowSignal = { rating: 2, recencyBucket: "THIS_WEEK" as RecencyBucket, bodyFingerprint: "fp_match_0001" };

interface RowFixtureShape {
  /** Rows as seen at locate time (document order). */
  rows: readonly ReviewRowSignal[];
  /** Rows as seen at highlight-time re-validation. Differs from {@link rows} ONLY in `rows-drift`. */
  revalidateRows: readonly ReviewRowSignal[];
}

function rowShapeFor(mode: ReplyFixtureMode): RowFixtureShape {
  switch (mode) {
    case "rows-present": {
      const rows = [NON_MATCH_A, MATCH, NON_MATCH_B];
      return { rows, revalidateRows: rows };
    }
    case "rows-ambiguous": {
      const rows = [MATCH, NON_MATCH_A, MATCH];
      return { rows, revalidateRows: rows };
    }
    case "rows-missing": {
      const rows = [NON_MATCH_A, NON_MATCH_B];
      return { rows, revalidateRows: rows };
    }
    case "rows-drift": {
      // Locate finds the unique match at index 1; by highlight time the match has moved to index 0, so
      // its structural sig differs — the anti-drift re-validation must fail closed.
      return { rows: [NON_MATCH_A, MATCH, NON_MATCH_B], revalidateRows: [MATCH, NON_MATCH_A, NON_MATCH_B] };
    }
    default:
      return { rows: [], revalidateRows: [] };
  }
}

/** The pure row locate decision for a mode + hint — what the fixture driver and any test would compute. */
export function fixtureRowLocateDecision(mode: ReplyFixtureMode, hint: ReplyTargetHint = REPLY_FIXTURE_HINT): LocateRowResult {
  return reviewRowLocateDecision(hint, rowShapeFor(mode).rows);
}

/**
 * Fixture driver — the synthetic-ladder rung that runs the SHARED locate decision over fixture
 * signals (rather than the fully-configurable {@link SyntheticReplySubmitDriver}). The seller's submit
 * is delivered via {@link applySubmit}; the driver never submits.
 */
export class FixtureReplySubmitDriver implements ReplySubmitProbeDriver {
  private readonly shape: FixtureShape;
  private readonly rowShape: RowFixtureShape;
  private readonly hint: ReplyTargetHint;
  private readonly locateResult: LocateComposerResult;
  private submitResolve: ((observed: boolean) => void) | null = null;
  private pending: boolean | null = null;
  private rowOpenResolve: ((observed: boolean) => void) | null = null;
  private pendingRowOpen: boolean | null = null;

  constructor(mode: ReplyFixtureMode, hint: ReplyTargetHint = REPLY_FIXTURE_HINT, rowsOverride?: RowFixtureShape) {
    this.shape = shapeFor(mode);
    this.rowShape = rowsOverride ?? rowShapeFor(mode);
    this.hint = hint;
    this.locateResult = fixtureLocateDecision(mode);
  }

  prepareSurface(): Promise<SurfaceProbeResult> {
    return Promise.resolve(this.shape.surface);
  }
  locateReviewRow(): Promise<LocateRowResult> {
    return Promise.resolve(reviewRowLocateDecision(this.hint, this.rowShape.rows));
  }
  highlightRow(): Promise<LocateRowResult> {
    // Anti-drift: re-run the decision over the rows as seen at highlight time. Only `rows-drift` differs.
    return Promise.resolve(reviewRowLocateDecision(this.hint, this.rowShape.revalidateRows));
  }
  armRowObserve(): Promise<void> {
    return Promise.resolve();
  }
  waitForRowOpen(): Promise<boolean> {
    if (this.pendingRowOpen !== null) {
      const v = this.pendingRowOpen;
      this.pendingRowOpen = null;
      return Promise.resolve(v);
    }
    return new Promise((resolve) => {
      this.rowOpenResolve = resolve;
    });
  }
  locateComposer(): Promise<LocateComposerResult> {
    return Promise.resolve(this.locateResult);
  }
  highlight(): Promise<void> {
    return Promise.resolve();
  }
  armObserve(): Promise<void> {
    return Promise.resolve();
  }
  waitForSubmit(): Promise<boolean> {
    if (this.pending !== null) {
      const v = this.pending;
      this.pending = null;
      return Promise.resolve(v);
    }
    return new Promise((resolve) => {
      this.submitResolve = resolve;
    });
  }
  cleanup(): Promise<void> {
    return Promise.resolve();
  }

  /** TEST-ONLY: the operator opened the review's reply control (or did not). The driver never clicks. */
  applyRowOpen(observed = true): void {
    if (this.rowOpenResolve) {
      const resolve = this.rowOpenResolve;
      this.rowOpenResolve = null;
      resolve(observed);
    } else {
      this.pendingRowOpen = observed;
    }
  }

  /** TEST-ONLY: the seller submitted (or did not). The driver never submits itself. */
  applySubmit(observed = true): void {
    if (this.submitResolve) {
      const resolve = this.submitResolve;
      this.submitResolve = null;
      resolve(observed);
    } else {
      this.pending = observed;
    }
  }
}

/**
 * A rows-present fixture driver whose UNIQUE matching row bears an ARBITRARY body fingerprint (e.g. a real
 * `review-body-fingerprint/v1` value), with a hint that matches it. Used by the end-to-end Review Target
 * Binding proof to tie a backend-shaped hint to a fixture row via a REAL fingerprint. The non-matching rows
 * keep their distinct fingerprints so the match stays unique.
 */
export function rowsPresentDriverFor(bodyFingerprint: string): FixtureReplySubmitDriver {
  const hint: ReplyTargetHint = { rating: 2, recencyBucket: "THIS_WEEK", bodyFingerprint };
  const match: ReviewRowSignal = { rating: 2, recencyBucket: "THIS_WEEK", bodyFingerprint };
  const rows = [NON_MATCH_A, match, NON_MATCH_B];
  return new FixtureReplySubmitDriver("rows-present", hint, { rows, revalidateRows: rows });
}

/**
 * A driver whose page row shares the hint's rating + recency bucket but carries a DIFFERENT body fingerprint,
 * so the fingerprint is the ONLY thing that could match — and it does not. The run must fail closed
 * (TARGET_NOT_FOUND), proving the fingerprint is load-bearing for row targeting.
 */
export function rowsFingerprintMismatchDriver(hintFingerprint: string, rowFingerprint: string): FixtureReplySubmitDriver {
  const hint: ReplyTargetHint = { rating: 2, recencyBucket: "THIS_WEEK", bodyFingerprint: hintFingerprint };
  const rows: ReviewRowSignal[] = [{ rating: 2, recencyBucket: "THIS_WEEK", bodyFingerprint: rowFingerprint }];
  return new FixtureReplySubmitDriver("rows-present", hint, { rows, revalidateRows: rows });
}

/**
 * A CANARY-LADEN synthetic reply-composer DOM for the real-browser rung (`reply-browser.test.ts`,
 * `RUN_INTEGRATION` only). A real Chromium `Page` loads it via `page.setContent(...)` and satisfies
 * {@link ReplyPageLike}, so {@link NaverReplySubmitProbeDriver} runs its own read-only in-page
 * extraction over REAL markup — the reply analogue of the export `livePage`/`fixtureHtml` surface.
 *
 * 100% synthetic: NO marketplace trademark, HTML, or seller data. Every {@link REPLY_FIXTURE_CANARIES}
 * string is deliberately embedded (composer content, a phone number, a selector as the element id, a
 * URL) so the browser rung's no-leak sweep proves none of it crosses the sanitized v2 boundary. The
 * page has NO `<script>` and NO pre-applied `data-aw-reply-target` — the driver tags its own target.
 * A plain `<button>` submit control exists only so the TEST (or a human) can click it; the driver's
 * capture-phase observer records that boolean and NEVER clicks or types.
 */
export function replyComposerFixtureHtml(mode: ReplyFixtureMode): string {
  const [bodyText, phone, selector, url, rawDate, productName] = REPLY_FIXTURE_CANARIES as [
    string, string, string, string, string, string,
  ];
  const composerId = selector.replace(/^#/, "");
  // A reply composer the driver's EXTRACT_SIGNALS will match: a textarea whose accessible wording
  // carries a reply keyword (답변). Its VALUE carries a canary so we prove content never leaks.
  const composer = (idSuffix = ""): string =>
    `<textarea id="${composerId}${idSuffix}" aria-label="답변 작성" placeholder="답변을 입력하세요">${bodyText}</textarea>`;
  // A composer WITHOUT a reply keyword — present in the DOM but not a candidate (fail-closed count 0).
  const decoy = `<textarea aria-label="메모" placeholder="비공개 메모"></textarea>`;
  const submit = `<button type="button" id="aw-reply-submit">답변 등록</button>`;
  const leak = `<a id="aw-reply-src" href="${url}" hidden>출처</a><span hidden>${phone}</span>`;

  // One review row. Data attributes carry ONLY sanitized signals (rating / recency BUCKET / body hash) —
  // the row driver matches on these. The RAW date, RAW product name, and body snippet are canaries that
  // must never cross the sanitized boundary. Only the matching row hosts the composer (so the composer
  // scan finds exactly one after the operator opens the row); others carry a reply button only.
  const row = (i: number, sig: ReviewRowSignal, isMatch: boolean): string =>
    `<article data-review-row data-rating="${sig.rating}" data-recency-bucket="${sig.recencyBucket}" data-fingerprint="${sig.bodyFingerprint}">
       <span class="rating">별점 ${sig.rating}</span>
       <time class="raw-date" hidden>${rawDate}</time>
       <p class="snippet">${bodyText}</p>
       <span class="product" hidden>${productName}</span>
       <button type="button" class="aw-reply-open" id="aw-reply-open-${i}">답변쓰기</button>
       ${isMatch ? composer() : ""}
     </article>`;

  const rowsHtml = (shape: RowFixtureShape): string =>
    shape.rows
      .map((sig, i) =>
        row(
          i,
          sig,
          sig.rating === REPLY_FIXTURE_HINT.rating &&
            sig.recencyBucket === REPLY_FIXTURE_HINT.recencyBucket &&
            sig.bodyFingerprint === REPLY_FIXTURE_HINT.bodyFingerprint,
        ),
      )
      .join("") + submit + leak;

  const inner = ((): string => {
    switch (mode) {
      case "composer-present":
      case "submitted":
        return composer() + submit + leak;
      case "composer-ambiguous":
        return composer("-a") + composer("-b") + submit + leak;
      case "composer-missing":
        return decoy + submit + leak;
      case "login-required":
        return `<section id="login-gate"><p>로그인이 필요합니다.</p></section>`;
      case "rows-present":
      case "rows-ambiguous":
      case "rows-missing":
      case "rows-drift":
        return rowsHtml(rowShapeFor(mode));
    }
  })();

  // `data-page` drives the driver's read-only loggedIn check: only "login-required" reads as logged out.
  const pageAttr = mode === "login-required" ? "login" : "review-management";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:system-ui;margin:0;padding:24px}
    textarea{display:block;width:320px;height:80px}
    button{margin-top:12px;font-size:16px;padding:8px 16px}
  </style></head><body data-page="${pageAttr}">
    <h1>리뷰 관리 (합성 픽스처)</h1>
    <section data-aw-scope="reply">${inner}</section>
  </body></html>`;
}
