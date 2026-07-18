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
