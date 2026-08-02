/**
 * The ADOPTED visual-recon selectors — the 6 fixed-label controls confirmed matchCount=1 on real NAVER
 * (runs #4/#5/#6). This locks that (a) every adopted selector reuses its candidate proposal (no drift), (b) each
 * is machine-proven adoptable through the frozen gate at matchCount===1, (c) they use only fixed labels (no app
 * name / credential value / position), and (d) adoption did NOT touch the issuance flag SELECTORS_CALIBRATED —
 * that flag gates a DIFFERENT (issuance highlight) selector set and stays false.
 */
import { describe, it, expect } from "vitest";
import {
  ADOPTED_TARGET_IDS,
  ADOPTED_VISUAL_RECON_SELECTORS,
  evaluateAdopted,
} from "../../../src/action-window/api-issuance-calibration/visual-recon-adopted";
import { VISUAL_RECON_CANDIDATES } from "../../../src/action-window/api-issuance-calibration/visual-recon-candidates";
import { SELECTORS_CALIBRATED } from "../../../src/action-window/api-issuance/api-center-adapter";

describe("adopted visual-recon selectors", () => {
  it("adopts exactly the 6 fixed-label controls confirmed matchCount=1 live (not 다시사용/시크릿-label)", () => {
    expect([...ADOPTED_TARGET_IDS]).toEqual([
      "app_list.register_application",
      "app_detail.application_section",
      "api_group.section",
      "credentials.application_id_label",
      "credentials.secret_view_button",
      "credentials.secret_copy_button",
    ]);
    // the state-dependent 다시사용 (0 live) and the gate-blocked 시크릿 label are NOT adopted.
    const ids = ADOPTED_VISUAL_RECON_SELECTORS.map((a) => a.targetId);
    expect(ids).not.toContain("app_list.reactivate_application");
    expect(ids).not.toContain("credentials.application_secret_label");
    expect(ADOPTED_VISUAL_RECON_SELECTORS).toHaveLength(6);
  });

  it("each adopted selector reuses its candidate proposal verbatim (single source of truth — no drift)", () => {
    for (const a of ADOPTED_VISUAL_RECON_SELECTORS) {
      const c = VISUAL_RECON_CANDIDATES.find((p) => p.targetId === a.targetId)!;
      expect(a.selector).toBe(c.candidate.selector);
      expect(a.liveMatchCount).toBe(1);
      expect(a.confirmedLiveRuns.length).toBeGreaterThan(0);
    }
  });

  it("uses ONLY fixed NAVER labels — never an app name, credential value, or a [value=] pin", () => {
    for (const a of ADOPTED_VISUAL_RECON_SELECTORS) {
      expect(/데이터수집|\[value=/i.test(a.selector)).toBe(false);
      // section anchor + id label are the same unique "애플리케이션 ID"; buttons/heading are fixed labels.
      expect(a.selector).toMatch(/애플리케이션 등록|애플리케이션 ID|API 그룹|보기|복사/);
    }
  });

  it("every adopted selector is machine-proven ADOPTABLE through the frozen gate at matchCount===1", () => {
    const evals = evaluateAdopted();
    expect(evals).toHaveLength(6);
    for (const e of evals) {
      expect(e.adoptable, `${e.targetId}: ${e.reasons.join(",")}`).toBe(true);
      expect(e.reasons).toEqual([]);
    }
  });

  it("adoption did NOT flip the issuance highlight flag — SELECTORS_CALIBRATED stays false (different subsystem)", () => {
    expect(SELECTORS_CALIBRATED).toBe(false);
  });
});
