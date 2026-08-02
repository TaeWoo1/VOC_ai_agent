/**
 * The CALIBRATED Phase-B highlight-target selector registry. This locks that (a) the 4 real controls map to
 * fixed-label locators DERIVED verbatim (no drift) from the live-confirmed visual-recon adopted set, (b)
 * `return` is never a highlight target (guidance-only), (c) `open_app` is honestly uncalibrated so the
 * existing-app path is `not_ready` while the new-app path is `ready_candidate`, and (d) every live_confirmed
 * locator passes the SAME frozen adoption gate the visual-recon adoption used.
 */
import { describe, it, expect } from "vitest";
import {
  ISSUANCE_HIGHLIGHT_TARGETS,
  ISSUANCE_GUIDANCE_ONLY_TARGETS,
  ISSUANCE_TARGET_SELECTORS,
  OPEN_APP_STRUCTURAL_SELECTOR,
  isIssuanceHighlightTarget,
  isGuidedHighlightTarget,
  locatorFor,
  structuralSelectorFor,
  selectorSpecFor,
  issuancePathReadiness,
  evaluateIssuanceHighlightSelectors,
} from "../../../src/action-window/api-issuance-calibration/issuance-highlight-selectors";
import { VISUAL_RECON_LABEL_PROBES } from "../../../src/action-window/api-issuance-calibration/visual-recon-candidates";
import { ADOPTED_TARGET_IDS } from "../../../src/action-window/api-issuance-calibration/visual-recon-adopted";
import { ISSUANCE_TARGETS } from "../../../src/action-window/api-issuance/issuance-driver";
import { CANDIDATE_APP_ENTRY_SELECTOR } from "../../../src/action-window/naver-issuance-driver";
import { SELECTORS_CALIBRATED } from "../../../src/action-window/api-issuance/api-center-adapter";

describe("issuance highlight-target selector registry", () => {
  it("covers exactly the 4 real NAVER controls as highlight targets — `return` is guidance-only, never highlighted", () => {
    expect([...ISSUANCE_HIGHLIGHT_TARGETS]).toEqual(["create_app", "open_app", "api_group", "credentials"]);
    expect([...ISSUANCE_GUIDANCE_ONLY_TARGETS]).toEqual(["return"]);
    // Highlight ∪ guidance-only == the whole issuance target set (nothing dropped, nothing double-counted).
    expect([...ISSUANCE_HIGHLIGHT_TARGETS, ...ISSUANCE_GUIDANCE_ONLY_TARGETS].sort()).toEqual([...ISSUANCE_TARGETS].sort());
    expect(isIssuanceHighlightTarget("return")).toBe(false);
    expect(isIssuanceHighlightTarget("create_app")).toBe(true);
  });

  it("derives each live_confirmed locator VERBATIM from its adopted visual-recon fixed-label probe (no drift)", () => {
    for (const spec of ISSUANCE_TARGET_SELECTORS) {
      if (spec.status !== "live_confirmed") continue;
      expect(spec.derivesFrom, `${spec.target} must derive from an adopted target`).toBeDefined();
      expect(ADOPTED_TARGET_IDS as readonly string[]).toContain(spec.derivesFrom!);
      const probe = VISUAL_RECON_LABEL_PROBES.find((p) => p.targetId === spec.derivesFrom);
      expect(probe).toBeDefined();
      expect(spec.locator).toEqual({ candidateQuery: probe!.candidateQuery, exactText: probe!.exactText });
    }
  });

  it("uses ONLY fixed NAVER labels — never an app name, credential value, or [value=] pin", () => {
    for (const spec of ISSUANCE_TARGET_SELECTORS) {
      if (!spec.locator) continue;
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
      if (!spec.locator) continue;
      expect(spec.locator.candidateQuery).toBe(EXPECTED_CANDIDATE_QUERY[spec.target]);
    }
  });

  it("gives open_app a value-free STRUCTURAL anchor candidate (no fixed label) — existing-app path still not_ready", () => {
    const openApp = selectorSpecFor("open_app");
    expect(openApp.status).toBe("structural_candidate");
    expect(openApp.kind).toBe("structural");
    expect(openApp.locator).toBeUndefined(); // not a fixed-label target
    expect(locatorFor("open_app")).toBeNull();
    expect(openApp.structuralSelector).toBe(OPEN_APP_STRUCTURAL_SELECTOR);
    expect(structuralSelectorFor("open_app")).toBe(OPEN_APP_STRUCTURAL_SELECTOR);
    expect(openApp.paths).toEqual(["existing_app"]);
    // The anchor is purely structural (tags/roles), never a value pin / app name / credential token.
    expect(/\[\s*value\s*=|시크릿|secret|애플리케이션/i.test(OPEN_APP_STRUCTURAL_SELECTOR)).toBe(false);
  });

  it("pins the open_app structural anchor to the SAME app-entry-row hypothesis the driver counts rows with", () => {
    expect(OPEN_APP_STRUCTURAL_SELECTOR).toBe(CANDIDATE_APP_ENTRY_SELECTOR);
  });

  it("only live_confirmed targets are GUIDED-highlightable — the open_app candidate is NOT (probe measures it, guide won't)", () => {
    expect(isGuidedHighlightTarget("create_app")).toBe(true);
    expect(isGuidedHighlightTarget("api_group")).toBe(true);
    expect(isGuidedHighlightTarget("credentials")).toBe(true);
    // The unmeasured structural candidate must never be highlighted by the guided walk until it is promoted.
    expect(isGuidedHighlightTarget("open_app")).toBe(false);
  });

  it("SELECTORS_CALIBRATED is true (new-app scope) AND that flip is honest: every guided-highlightable target is live_confirmed", () => {
    // Pins the flag's VALUE (catches a silent revert) AND ties it to the honest scope: the flag may be true
    // only because the new-app path is live_confirmed while open_app stays a non-guided-highlightable candidate.
    expect(SELECTORS_CALIBRATED).toBe(true);
    for (const spec of ISSUANCE_TARGET_SELECTORS) {
      if (isGuidedHighlightTarget(spec.target)) expect(spec.status).toBe("live_confirmed");
    }
    // The new-app path is fully guided-highlightable; open_app (existing-app) is not — that is the v1 scope.
    for (const t of ["create_app", "api_group", "credentials"] as const) expect(isGuidedHighlightTarget(t)).toBe(true);
    expect(isGuidedHighlightTarget("open_app")).toBe(false);
  });

  it("splits path readiness: new_app = ready_candidate, existing_app = not_ready", () => {
    expect(issuancePathReadiness("new_app")).toBe("ready_candidate");
    expect(issuancePathReadiness("existing_app")).toBe("not_ready");
  });

  it("every live_confirmed locator is machine-proven ADOPTABLE through the frozen gate; open_app is not", () => {
    const evals = evaluateIssuanceHighlightSelectors();
    const byTarget = new Map(evals.map((e) => [e.target, e]));
    for (const t of ["create_app", "api_group", "credentials"] as const) {
      const e = byTarget.get(t)!;
      expect(e.adoptable, `${t}: ${e.reasons.join(",")}`).toBe(true);
      expect(e.reasons).toEqual([]);
    }
    const openApp = byTarget.get("open_app")!;
    expect(openApp.adoptable).toBe(false);
    // Unmeasured AND not-yet-screenshot-confirmed as the open control → honestly unadoptable on both counts.
    expect(openApp.reasons).toContain("NOT_UNIQUE");
    expect(openApp.reasons).toContain("SCREENSHOT_TARGET_UNCONFIRMED");
  });

  it("api_group and credentials are reached on BOTH paths; create_app only on new_app", () => {
    expect(selectorSpecFor("create_app").paths).toEqual(["new_app"]);
    expect(selectorSpecFor("api_group").paths).toEqual(["new_app", "existing_app"]);
    expect(selectorSpecFor("credentials").paths).toEqual(["new_app", "existing_app"]);
  });
});
