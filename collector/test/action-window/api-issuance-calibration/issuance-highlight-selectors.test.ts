/**
 * The CALIBRATED Phase-B highlight-target selector registry. This locks that (a) the 3 highlighted controls map
 * to fixed-label locators DERIVED verbatim (no drift) from the live-confirmed visual-recon adopted set, (b)
 * `return` (terminal) and `open_app` (existing-app step) are guidance-only — never highlight targets, (c)
 * `open_app` is specifically a NAVIGATION target (guidance + observed app_detail transition), so BOTH onboarding
 * paths are `ready_candidate`, and (d) every live_confirmed locator passes the SAME frozen adoption gate the
 * visual-recon adoption used.
 */
import { describe, it, expect } from "vitest";
import {
  ISSUANCE_HIGHLIGHT_TARGETS,
  ISSUANCE_GUIDANCE_ONLY_TARGETS,
  ISSUANCE_NAVIGATION_TARGETS,
  ISSUANCE_TARGET_SELECTORS,
  isIssuanceHighlightTarget,
  isIssuanceNavigationTarget,
  isGuidedHighlightTarget,
  locatorFor,
  selectorSpecFor,
  issuancePathReadiness,
  evaluateIssuanceHighlightSelectors,
} from "../../../src/action-window/api-issuance-calibration/issuance-highlight-selectors";
import { VISUAL_RECON_LABEL_PROBES } from "../../../src/action-window/api-issuance-calibration/visual-recon-candidates";
import { ADOPTED_TARGET_IDS } from "../../../src/action-window/api-issuance-calibration/visual-recon-adopted";
import { ISSUANCE_TARGETS } from "../../../src/action-window/api-issuance/issuance-driver";
import { SELECTORS_CALIBRATED } from "../../../src/action-window/api-issuance/api-center-adapter";

describe("issuance highlight-target selector registry", () => {
  it("covers exactly the 3 highlighted NAVER controls — `open_app` and `return` are guidance-only", () => {
    expect([...ISSUANCE_HIGHLIGHT_TARGETS]).toEqual(["create_app", "api_group", "credentials"]);
    // `open_app` (existing-app step 2) and `return` (final step) are both guidance-only, never highlighted.
    expect([...ISSUANCE_GUIDANCE_ONLY_TARGETS]).toEqual(["open_app", "return"]);
    // Highlight ∪ guidance-only == the whole issuance target set (nothing dropped, nothing double-counted).
    expect([...ISSUANCE_HIGHLIGHT_TARGETS, ...ISSUANCE_GUIDANCE_ONLY_TARGETS].sort()).toEqual([...ISSUANCE_TARGETS].sort());
    expect(isIssuanceHighlightTarget("return")).toBe(false);
    expect(isIssuanceHighlightTarget("open_app")).toBe(false);
    expect(isIssuanceHighlightTarget("create_app")).toBe(true);
  });

  it("marks `open_app` as the NAVIGATION guidance target (observed app_detail transition), not `return`", () => {
    expect([...ISSUANCE_NAVIGATION_TARGETS]).toEqual(["open_app"]);
    expect(isIssuanceNavigationTarget("open_app")).toBe(true);
    // `return` is terminal guidance (auto-completes), not a navigation to observe.
    expect(isIssuanceNavigationTarget("return")).toBe(false);
    expect(isIssuanceNavigationTarget("create_app")).toBe(false);
  });

  it("derives each live_confirmed locator VERBATIM from its adopted visual-recon fixed-label probe (no drift)", () => {
    for (const spec of ISSUANCE_TARGET_SELECTORS) {
      expect(spec.status).toBe("live_confirmed");
      expect(ADOPTED_TARGET_IDS as readonly string[]).toContain(spec.derivesFrom);
      const probe = VISUAL_RECON_LABEL_PROBES.find((p) => p.targetId === spec.derivesFrom);
      expect(probe).toBeDefined();
      expect(spec.locator).toEqual({ candidateQuery: probe!.candidateQuery, exactText: probe!.exactText });
    }
  });

  it("uses ONLY fixed NAVER labels — never an app name, credential value, or [value=] pin", () => {
    for (const spec of ISSUANCE_TARGET_SELECTORS) {
      expect(spec.locator.exactText).toMatch(/애플리케이션 등록|API 그룹|애플리케이션 ID/);
      // BOTH halves of the locator are pinned: the FIXED label AND the STRUCTURAL candidate query must carry no
      // value pin / credential-value token, so a future edit to either half in the source probe trips a guard.
      for (const half of [spec.locator.exactText, spec.locator.candidateQuery]) {
        expect(/\[\s*value\s*=|시크릿|secret/i.test(half)).toBe(false);
      }
    }
  });

  it("pins each candidateQuery to a purely STRUCTURAL selector (tags/roles only — no attribute-value pin)", () => {
    const EXPECTED_CANDIDATE_QUERY: Record<string, string> = {
      create_app: "button, a, [role='button']",
      api_group: "h1,h2,h3,h4,h5,h6,[role='heading']",
      credentials: "th,td,dt,label,span,div",
    };
    for (const spec of ISSUANCE_TARGET_SELECTORS) {
      expect(spec.locator.candidateQuery).toBe(EXPECTED_CANDIDATE_QUERY[spec.target]);
    }
  });

  it("open_app has NO highlight spec at all — it is guidance, not a highlighted control", () => {
    expect(ISSUANCE_TARGET_SELECTORS.some((s) => (s.target as string) === "open_app")).toBe(false);
    expect(() => selectorSpecFor("open_app" as never)).toThrow();
  });

  it("all three highlight targets are GUIDED-highlightable (live_confirmed); guidance targets are not", () => {
    expect(isGuidedHighlightTarget("create_app")).toBe(true);
    expect(isGuidedHighlightTarget("api_group")).toBe(true);
    expect(isGuidedHighlightTarget("credentials")).toBe(true);
  });

  it("SELECTORS_CALIBRATED is true AND that flip is honest: every guided-highlightable target is live_confirmed", () => {
    // Pins the flag's VALUE (catches a silent revert) AND ties it to the honest scope: the flag is true because
    // every highlighted control (create_app/api_group/credentials) is live_confirmed — the existing-app open
    // step adds no selector to calibrate (it is navigation guidance).
    expect(SELECTORS_CALIBRATED).toBe(true);
    for (const spec of ISSUANCE_TARGET_SELECTORS) {
      if (isGuidedHighlightTarget(spec.target)) expect(spec.status).toBe("live_confirmed");
    }
    for (const t of ["create_app", "api_group", "credentials"] as const) expect(isGuidedHighlightTarget(t)).toBe(true);
  });

  it("splits path readiness: BOTH new_app and existing_app are ready_candidate (existing-app open is guidance)", () => {
    // The existing-app path's only highlight targets are api_group + credentials (both live_confirmed); its
    // step-2 open is navigation guidance with no highlight to calibrate — so it is ready_candidate, like new_app.
    expect(issuancePathReadiness("new_app")).toBe("ready_candidate");
    expect(issuancePathReadiness("existing_app")).toBe("ready_candidate");
  });

  it("every live_confirmed locator is machine-proven ADOPTABLE through the frozen gate", () => {
    const evals = evaluateIssuanceHighlightSelectors();
    const byTarget = new Map(evals.map((e) => [e.target, e]));
    for (const t of ["create_app", "api_group", "credentials"] as const) {
      const e = byTarget.get(t)!;
      expect(e.adoptable, `${t}: ${e.reasons.join(",")}`).toBe(true);
      expect(e.reasons).toEqual([]);
    }
    // open_app is not evaluated — it has no fixed-label spec.
    expect(byTarget.has("open_app" as never)).toBe(false);
  });

  it("api_group and credentials are reached on BOTH paths; create_app only on new_app", () => {
    expect(selectorSpecFor("create_app").paths).toEqual(["new_app"]);
    expect(selectorSpecFor("api_group").paths).toEqual(["new_app", "existing_app"]);
    expect(selectorSpecFor("credentials").paths).toEqual(["new_app", "existing_app"]);
  });
});
