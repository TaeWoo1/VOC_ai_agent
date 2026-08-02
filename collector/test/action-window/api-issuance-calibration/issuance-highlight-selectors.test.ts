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
  isIssuanceHighlightTarget,
  locatorFor,
  selectorSpecFor,
  issuancePathReadiness,
  evaluateIssuanceHighlightSelectors,
} from "../../../src/action-window/api-issuance-calibration/issuance-highlight-selectors";
import { VISUAL_RECON_LABEL_PROBES } from "../../../src/action-window/api-issuance-calibration/visual-recon-candidates";
import { ADOPTED_TARGET_IDS } from "../../../src/action-window/api-issuance-calibration/visual-recon-adopted";
import { ISSUANCE_TARGETS } from "../../../src/action-window/api-issuance/issuance-driver";

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

  it("marks open_app as UNCALIBRATED (no fixed label) with no locator — the existing-app path is not_ready", () => {
    const openApp = selectorSpecFor("open_app");
    expect(openApp.status).toBe("no_fixed_label");
    expect(openApp.locator).toBeUndefined();
    expect(locatorFor("open_app")).toBeNull();
    expect(openApp.paths).toEqual(["existing_app"]);
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
    expect(openApp.reasons).toContain("NOT_UNIQUE");
  });

  it("api_group and credentials are reached on BOTH paths; create_app only on new_app", () => {
    expect(selectorSpecFor("create_app").paths).toEqual(["new_app"]);
    expect(selectorSpecFor("api_group").paths).toEqual(["new_app", "existing_app"]);
    expect(selectorSpecFor("credentials").paths).toEqual(["new_app", "existing_app"]);
  });
});
