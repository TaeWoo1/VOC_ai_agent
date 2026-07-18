/**
 * **Reply-submission synthetic fixture (ISOLATED, offline).**
 *
 * A PURE DATA fixture modeling the NAVER reply composer surface — no browser, no scripts, no timers.
 * It carries HOSTILE content (canaries: a fake reply body, PII-shaped strings, a selector) precisely
 * so the no-leak tests can prove none of it ever crosses the sanitized contract boundary. A fixture
 * driver composes the pure {@link replyComposerLocateDecision} over these signals, so the synthetic
 * ladder (rung 1) exercises the same decision the live driver will.
 */
import { replyComposerLocateDecision } from "./reply-surface";
import type { ReplySubmitProbeDriver } from "./reply-driver";
import type { LocateComposerResult, SurfaceProbeResult } from "./reply-engine";

/** Hostile strings that must NEVER appear in any emitted event/view/ack. */
export const REPLY_FIXTURE_CANARIES: readonly string[] = [
  "고객님 배송이 늦어 죄송합니다 — 합성 답변 본문",
  "010-1234-5678",
  "#reply-composer-textarea",
  "https://sell.smartstore.naver.com/reply",
];

export type ReplyFixtureMode =
  | "composer-present"
  | "composer-missing"
  | "composer-ambiguous"
  | "login-required"
  | "submitted";

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

/**
 * Fixture driver — the synthetic-ladder rung that runs the SHARED locate decision over fixture
 * signals (rather than the fully-configurable {@link SyntheticReplySubmitDriver}). The seller's submit
 * is delivered via {@link applySubmit}; the driver never submits.
 */
export class FixtureReplySubmitDriver implements ReplySubmitProbeDriver {
  private readonly shape: FixtureShape;
  private readonly locateResult: LocateComposerResult;
  private submitResolve: ((observed: boolean) => void) | null = null;
  private pending: boolean | null = null;

  constructor(mode: ReplyFixtureMode) {
    this.shape = shapeFor(mode);
    this.locateResult = fixtureLocateDecision(mode);
  }

  prepareSurface(): Promise<SurfaceProbeResult> {
    return Promise.resolve(this.shape.surface);
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
  const [bodyText, phone, selector, url] = REPLY_FIXTURE_CANARIES as [string, string, string, string];
  const composerId = selector.replace(/^#/, "");
  // A reply composer the driver's EXTRACT_SIGNALS will match: a textarea whose accessible wording
  // carries a reply keyword (답변). Its VALUE carries a canary so we prove content never leaks.
  const composer = (idSuffix = ""): string =>
    `<textarea id="${composerId}${idSuffix}" aria-label="답변 작성" placeholder="답변을 입력하세요">${bodyText}</textarea>`;
  // A composer WITHOUT a reply keyword — present in the DOM but not a candidate (fail-closed count 0).
  const decoy = `<textarea aria-label="메모" placeholder="비공개 메모"></textarea>`;
  const submit = `<button type="button" id="aw-reply-submit">답변 등록</button>`;
  const leak = `<a id="aw-reply-src" href="${url}" hidden>출처</a><span hidden>${phone}</span>`;

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
