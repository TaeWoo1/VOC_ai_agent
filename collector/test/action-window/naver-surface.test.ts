/**
 * Unit tests for the shared NAVER export-surface decision core (`src/action-window/naver-surface.ts`).
 * Offline, no browser, no backend. Covers: the session-verdict → precondition mapping, the readiness
 * gate, the no-click locate (0/1/many/async), the post-action verify (drift / completion), signature
 * determinism + opacity, fixture/live decision parity, and the sanitized-output privacy boundary.
 */
import { describe, it, expect } from "vitest";
import {
  naverSurfaceDecision,
  naverLocateDecision,
  naverVerifyDecision,
  targetSigFor,
  type ExportCandidate,
} from "../../src/action-window/naver-surface";
import { classifySessionVerdict, type SessionVerdict } from "../../src/naver/session-verdict";
import { findExportCandidates } from "../../src/naver/review-export";
import { NaverReviewExportSurfaceFixture, type NaverFixtureMode } from "../../src/action-window/naver-fixture";
import { NaverFixtureProbeDriver } from "../../src/action-window/naver-driver";

const HEX16 = /^[0-9a-f]{16}$/;

const ROWS = `<table><tbody><tr><td>합성 행 A</td></tr><tr><td>합성 행 B</td></tr></tbody></table>`;
const EMPTY_RESULTS = `<table><tbody></tbody></table>`;
const ONE_CONTROL = `${ROWS}<button id="exp">엑셀다운로드</button>`;
const TWO_CONTROLS = `${ROWS}<button id="exp">엑셀다운로드</button><button id="exp2">리뷰 엑셀다운로드</button>`;
const NO_CONTROL = `${ROWS}<p>내보내기 도구 미제공</p>`;
const ASYNC_CONTROL = `${ROWS}<button id="exp">엑셀다운로드</button><span>다운로드 목록</span>`;

describe("naver-surface — session precondition decision", () => {
  it("LOGGED_IN + ready surface → ok, with a positive-readiness diagnostic", () => {
    const { result, diagnostic } = naverSurfaceDecision("LOGGED_IN", ROWS);
    expect(result).toEqual({ ok: true });
    expect(diagnostic.verdict).toBe("LOGGED_IN");
    expect(diagnostic.readinessDecision).toBe("READY");
    expect(diagnostic.readinessState).toBeUndefined();
  });

  it.each([
    ["RECONNECT_REQUIRED", "SESSION_EXPIRED"],
    ["ACCOUNT_LOGIN_REQUIRED", "LOGIN_REQUIRED"],
    ["AUTH_CHALLENGE_REQUIRED", "LOGIN_REQUIRED"],
    ["UNKNOWN", "UNSUPPORTED_STATE"],
  ] as const)("non-usable verdict %s fails closed → %s (diagnostic carries only the verdict)", (verdict, code) => {
    const { result, diagnostic } = naverSurfaceDecision(verdict as SessionVerdict, ROWS);
    expect(result).toEqual({ ok: false, blockerCode: code });
    expect(diagnostic).toEqual({ verdict });
  });

  it("LOGGED_IN but the export surface is empty → UNSUPPORTED_STATE, EMPTY preserved in the diagnostic", () => {
    const { result, diagnostic } = naverSurfaceDecision("LOGGED_IN", EMPTY_RESULTS);
    expect(result).toEqual({ ok: false, blockerCode: "UNSUPPORTED_STATE" });
    expect(diagnostic.readinessDecision).toBe("HALT");
    expect(diagnostic.readinessState).toBe("EXPORT_TARGET_EMPTY");
  });

  it("LOGGED_IN but an ambiguous (SPA-like) surface → UNSUPPORTED_STATE, UNKNOWN preserved", () => {
    const { result, diagnostic } = naverSurfaceDecision("LOGGED_IN", `<div>지연 렌더</div>`);
    expect(result).toEqual({ ok: false, blockerCode: "UNSUPPORTED_STATE" });
    expect(diagnostic.readinessState).toBe("EXPORT_TARGET_UNKNOWN");
  });

  // selectedRangePresent — POSITIVE direction, end-to-end (§8-24; D-025 falsifier, offline half only).
  // Run 5/6 saw the detector read `false` and log it; NO test proved the runtime carries a `true`
  // through `naverSurfaceDecision` into the exact `NaverPrepareDiagnostic` a live run logs. These prove
  // the plumbing. They do NOT (and cannot, offline) prove the LIVE positive — the `page.content()`
  // attribute-vs-IDL-property blindness stays D-025's OPEN falsifier, provable only on real NAVER.
  const RANGE = `<input type="date" value="2026-06-01">`;

  it("LOGGED_IN + READY surface WITH a selected range → ok, and the diagnostic carries selectedRangePresent: true", () => {
    const { result, diagnostic } = naverSurfaceDecision("LOGGED_IN", `${ROWS}${RANGE}`);
    expect(result).toEqual({ ok: true });
    expect(diagnostic.readinessDecision).toBe("READY");
    expect(diagnostic.selectedRangePresent).toBe(true);
  });

  it("the same READY surface WITHOUT a range reports selectedRangePresent: false (not spuriously always-on)", () => {
    const { result, diagnostic } = naverSurfaceDecision("LOGGED_IN", ROWS);
    expect(result).toEqual({ ok: true });
    expect(diagnostic.readinessDecision).toBe("READY");
    expect(diagnostic.selectedRangePresent).toBe(false);
  });

  it("range observation is independent of the readiness HALT: an empty surface still logs selectedRangePresent: true", () => {
    // Per D-025 the range signal is observe-and-log only; it never gates and never overrides the
    // readiness decision. A selected range on an EMPTY (HALT) surface still propagates to the diagnostic.
    const { result, diagnostic } = naverSurfaceDecision("LOGGED_IN", `${EMPTY_RESULTS}${RANGE}`);
    expect(result.ok).toBe(false);
    expect(diagnostic.readinessDecision).toBe("HALT");
    expect(diagnostic.selectedRangePresent).toBe(true);
  });
});

describe("naver-surface — no-click locate decision", () => {
  it("exactly one sync export control → count 1 + an opaque 16-hex signature", () => {
    const r = naverLocateDecision(ONE_CONTROL);
    expect(r.count).toBe(1);
    expect(r.sig).toMatch(HEX16);
  });

  it("many controls → the ambiguous count, no signature (engine fails TARGET_AMBIGUOUS)", () => {
    expect(naverLocateDecision(TWO_CONTROLS)).toEqual({ count: 2 });
  });

  it("no export control → count 0 (engine fails TARGET_NOT_FOUND)", () => {
    expect(naverLocateDecision(NO_CONTROL)).toEqual({ count: 0 });
  });

  it("an async download-list affordance wins over the direct control → count 0 (not a sync surface)", () => {
    expect(naverLocateDecision(ASYNC_CONTROL)).toEqual({ count: 0 });
  });
});

describe("naver-surface — post-action verify decision", () => {
  const sig = naverLocateDecision(ONE_CONTROL).sig!;

  it("unchanged target + completion signal present → verified, no drift", () => {
    expect(naverVerifyDecision(ONE_CONTROL, sig, true)).toEqual({ verified: true, drift: false });
  });

  it("unchanged target but no completion signal → not verified, no drift (back to the checkpoint)", () => {
    expect(naverVerifyDecision(ONE_CONTROL, sig, false)).toEqual({ verified: false, drift: false });
  });

  it("a vanished or identity-changed target → drift (engine fails UI_DRIFT)", () => {
    const drifted = `${ROWS}<button id="exp-v2">내려받기</button>`;
    expect(naverVerifyDecision(drifted, sig, true)).toEqual({ verified: false, drift: true });
    expect(naverVerifyDecision(NO_CONTROL, sig, true)).toEqual({ verified: false, drift: true });
  });
});

describe("naver-surface — signature determinism & opacity", () => {
  it("the same control yields the same 16-hex sig; a different control yields a different sig", () => {
    const a = naverLocateDecision(ONE_CONTROL).sig!;
    const b = naverLocateDecision(ONE_CONTROL).sig!;
    const c = naverLocateDecision(`${ROWS}<button id="other">내려받기</button>`).sig!;
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(HEX16);
  });

  it("targetSigFor is a pure 16-hex hash of a candidate's identity (raw identity not recoverable)", () => {
    const candidate = findExportCandidates(ONE_CONTROL)[0] as ExportCandidate;
    const sig = targetSigFor(candidate);
    expect(sig).toMatch(HEX16);
    // The element id / wording keyword feed the hash but cannot be read back out of it.
    expect(sig).not.toContain(candidate.id ?? "");
    expect(sig.includes("엑셀")).toBe(false);
  });
});

describe("naver-surface — fixture/live decision parity (shared core, one source of truth)", () => {
  const MODES: readonly NaverFixtureMode[] = [
    "normal",
    "no-target",
    "multi-target",
    "drift",
    "empty-target",
    "ambiguous-readiness",
    "async-affordance",
    "reconnect-required",
    "login-required",
  ];

  it.each(MODES)("the fixture driver's stages equal the shared decisions on the same surface [%s]", async (mode) => {
    const fx = new NaverReviewExportSurfaceFixture(mode);
    const driver = new NaverFixtureProbeDriver(mode);

    const verdict = classifySessionVerdict(fx.sessionSignals());
    expect(await driver.prepareSurface()).toEqual(naverSurfaceDecision(verdict, fx.html()).result);
    expect(await driver.locate()).toEqual(naverLocateDecision(fx.html()));
  });
});

describe("naver-surface — privacy boundary", () => {
  // Surface CONTENT fragments that must never echo back. (The TEST-visible diagnostic legitimately
  // carries readiness enums like EXPORT_TARGET_EMPTY, so substrings of those are not leak needles.)
  const NEEDLES = ["엑셀", "다운로드", "내려받기", "합성", "<button", "password"];

  it("no decision output carries surface content (only counts/enums/booleans/opaque sigs)", () => {
    const blob = JSON.stringify([
      naverSurfaceDecision("LOGGED_IN", ONE_CONTROL),
      naverSurfaceDecision("LOGGED_IN", EMPTY_RESULTS),
      naverLocateDecision(ONE_CONTROL),
      naverLocateDecision(TWO_CONTROLS),
      naverVerifyDecision(ONE_CONTROL, naverLocateDecision(ONE_CONTROL).sig!, true),
    ]).toLowerCase();
    for (const needle of NEEDLES) {
      expect(blob.includes(needle.toLowerCase()), `decision output leaked "${needle}"`).toBe(false);
    }
  });
});
