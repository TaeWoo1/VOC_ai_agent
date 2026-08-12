/**
 * **The two steps the walk gained when the vendor screen was measured — and the one that issues the key.**
 *
 * The walk rested in front of `약관 동의 및 Key 발급받기` because what followed had never been read. It has been
 * now, so the walk continues, and the properties worth testing are the ones that keep "continues" from becoming
 * "does it for you": the press is the seller's, what advances the step is WING having ALREADY shown the keys,
 * and a run that starts on a page showing credentials cannot report that the seller just made them.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CoupangWingIssuanceDriver,
  OPERATOR_STEP_LABELS,
  OPERATOR_STEP_TITLES,
} from "../../../src/action-window/coupang-wing-issuance-driver";
import {
  COUPANG_ISSUANCE_CHECKPOINT_TARGETS,
  COUPANG_ISSUANCE_TARGETS,
  COUPANG_TARGET_BARRIER_STAGE,
} from "../../../src/action-window/coupang-issuance/coupang-issuance-driver";
import {
  COUPANG_ISSUANCE_KEY_CREATION_STEP,
  coupangIssuanceStepPlan,
} from "../../../src/action-window/coupang-issuance/coupang-issuance-stages";
import {
  WING_VENDOR_METHOD_PRODUCT_DECISION,
  wingCandidateSpecById,
  wingGuidedHighlightPromotion,
} from "../../../src/action-window/coupang-wing-label-recon";
import { COUPANG_WING_GUIDED_WALK_BOUNDARY, PHASE_ENTRYPOINTS } from "../../../src/cli/approval-manifest";

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIVER_SRC = readFileSync(resolve(HERE, "../../../src/action-window/coupang-wing-issuance-driver.ts"), "utf8");

/* ══════════════════════════ where the walk now ends ══════════════════════════ */

describe("the walk's end moved to the control that actually issues", () => {
  it("**the key-creation step is the vendor screen's 확인**, and it is the last guided control", () => {
    const plan = coupangIssuanceStepPlan();
    expect(COUPANG_ISSUANCE_KEY_CREATION_STEP).toBe(7);
    expect(plan[COUPANG_ISSUANCE_KEY_CREATION_STEP - 1]!.copyParams?.targetKind).toBe("vendor_confirm");
    // …and the two steps after it read and return. Nothing guided follows the key.
    expect(plan.slice(COUPANG_ISSUANCE_KEY_CREATION_STEP).map((s) => s.copyParams?.targetKind)).toEqual([
      "credentials",
      "return",
    ]);
  });

  it("both new steps are seller CHECKPOINTS with their own barrier stage", () => {
    for (const t of ["vendor_method", "vendor_confirm"] as const) {
      expect(COUPANG_ISSUANCE_TARGETS, t).toContain(t);
      expect(COUPANG_ISSUANCE_CHECKPOINT_TARGETS, t).toContain(t);
    }
    // `checkpoint_before_issue` held the key-creation name through two corrections while guarding a control that
    // creates nothing. The barrier with the consequence has its own stage now.
    expect(COUPANG_TARGET_BARRIER_STAGE.vendor_confirm).toBe("checkpoint_issue_key");
    expect(COUPANG_TARGET_BARRIER_STAGE.issue_final).toBe("checkpoint_before_issue");
  });
});

/* ══════════════════════════ the rings ══════════════════════════ */

describe("the vendor rings are resolved from the promotion record, never re-typed", () => {
  it("both plans resolve by candidate id, so withdrawing a calibration removes the ring by itself", () => {
    const plan = DRIVER_SRC.slice(DRIVER_SRC.indexOf("const GUIDED_RING_PLAN"), DRIVER_SRC.indexOf("function promotedRingSpecs"));
    expect(plan).toContain('vendor_method: { primary: "vendor_self_dev"');
    expect(plan).toContain('vendor_confirm: { primary: "vendor_confirm"');
    // No query string may appear in the driver for either — a second hand-written copy is how a ring ends up
    // pointing with a string the calibration no longer covers.
    expect(plan).not.toContain("자체개발(직접입력)");
    for (const t of ["vendor_self_dev", "vendor_confirm"] as const) {
      const p = wingGuidedHighlightPromotion(t);
      expect(p.promoted, t).toBe(true);
      expect(p.screen, t).toBe("VENDOR_METHOD");
      expect(() => wingCandidateSpecById(p.candidateId!), t).not.toThrow();
    }
  });

  it("**the method ring is on the option's LABEL**, and it is the option the product owner chose", () => {
    const spec = wingCandidateSpecById(wingGuidedHighlightPromotion("vendor_self_dev").candidateId!);
    expect(spec.candidateQuery).toBe("label");
    expect(spec.exactText).toBe(WING_VENDOR_METHOD_PRODUCT_DECISION.method);
    // The descriptor the operator grants against says the same thing, and says whose decision it was.
    expect(COUPANG_WING_GUIDED_WALK_BOUNDARY.vendorMethodGuided).toBe(spec.exactText);
    expect(COUPANG_WING_GUIDED_WALK_BOUNDARY.ringedInputControlCount).toBe(0);
  });

  it("the key-issuing ring is narrowed to ACTIONABLE elements", () => {
    // The same candidate the purpose screen's 확인 uses. `button,a` is what separated the key-creation control
    // from its identically-worded heading, and it is the only shape a ring may point with.
    const spec = wingCandidateSpecById(wingGuidedHighlightPromotion("vendor_confirm").candidateId!);
    expect(spec.candidateQuery).toBe("button,a");
    expect(spec.exactText).toBe("확인");
  });
});

/* ══════════════════════════ what advances the key step ══════════════════════════ */

describe("the key-issuing step advances on the RESULT, never on the press", () => {
  it("is the ONLY step keyed on a page category, and the map is a separate one", () => {
    const map = DRIVER_SRC.slice(
      DRIVER_SRC.indexOf("const CHECKPOINT_ADVANCES_TO_CATEGORY"),
      DRIVER_SRC.indexOf("/** How often the screen observation runs"),
    );
    expect(map).toContain('vendor_confirm: "credential_shown"');
    // Nothing else. A second entry here would be a step advancing on a page category rather than on the flow
    // screen its own action produces — a different kind of claim, made silently.
    expect(map.match(/^\s+\w+: "/gm) ?? []).toHaveLength(1);
    // …and the screen map gained exactly the one measured entry.
    const screens = DRIVER_SRC.slice(
      DRIVER_SRC.indexOf("const CHECKPOINT_ADVANCES_TO_SCREEN"),
      DRIVER_SRC.indexOf("/**\n * **The step that advances on a PAGE CATEGORY"),
    );
    expect(screens).toContain('issue_final: "VENDOR_METHOD"');
    // The key-issuing step must NOT be in it: a flow-screen advance fires on a screen appearing, and the vendor
    // screen is already on the glass when the seller presses 확인.
    expect(screens).not.toContain("vendor_confirm:");
  });

  it("**a run that STARTS on a credentials page cannot report the seller just made one**", async () => {
    // The same baseline rule the screen advance has, for the same reason: without it the first poll simply asks
    // "are credentials showing", and a seller who re-entered the walk on an already-issued page would have the
    // key step complete itself while they had done nothing at all.
    const body = DRIVER_SRC.slice(DRIVER_SRC.indexOf("private async observeOverlayAdvance"));
    const fn = body.slice(0, body.indexOf("\n  /**", 1));
    expect(fn).toContain("categoryBaseline !== null && categoryBaseline !== expectedCategory");
    // An UNREADABLE baseline disables it too — not knowing where the seller started is exactly the state in
    // which "the credentials are showing" cannot be told from "they were showing all along".
    expect(fn).toContain("categoryBaseline !== null");
  });

  it("the driver reaches no press/type path for either new step", async () => {
    // A step whose whole subject is a seller typing their company details into three fields is exactly where a
    // `.fill()` would look reasonable.
    const driver = new CoupangWingIssuanceDriver({ url: () => "https://wing.coupang.com", on: () => undefined } as never);
    expect(driver).toBeTruthy();
    for (const f of [".click(", ".fill(", ".type(", ".press(", ".check(", ".selectOption(", ".setChecked("]) {
      expect(DRIVER_SRC, `the driver must not reach ${f}`).not.toContain(f);
    }
  });
});

/* ══════════════════════════ what the seller is told ══════════════════════════ */

describe("the copy carries the consequence exactly once, on the control that has it", () => {
  it("the key-issuing step names the consequence in BOTH the panel and the chip", () => {
    expect(OPERATOR_STEP_LABELS.vendor_confirm).toContain("여기서 실제 API 키가 발급되어 라이브 계정 상태가 바뀝니다");
    expect(OPERATOR_STEP_LABELS.vendor_confirm).toContain("별도의 삭제 작업이 필요합니다");
    // NOT "되돌릴 수 없습니다". Narrowed 2026-08-12: WING has a 삭제 control, the operator has used it, and this
    // repository has a deletion phase built on it. A warning the reader can personally falsify is not the
    // cautious side of this — it devalues the one on the deletion phase, which IS irreversible.
    expect(OPERATOR_STEP_LABELS.vendor_confirm).not.toContain("되돌릴 수 없");
    // Every other chip names a control; this one names the consequence, because the panel alone should not have
    // to carry a fact this size — and the chip cannot wrap, so it was truncated once already.
    expect(OPERATOR_STEP_TITLES.vendor_confirm).toContain("키 발급");
  });

  it("**no OTHER step claims a key is created** — the warning is not spread around", () => {
    for (const [target, label] of Object.entries(OPERATOR_STEP_LABELS)) {
      if (target === "vendor_confirm") continue;
      expect(label, target).not.toContain("키가 발급됩니다");
      expect(label, target).not.toContain("여기서 실제로 키가 생성됩니다");
    }
    // `issue_final` says the opposite — attributed, because SellerOps cannot confirm an absence it is
    // structurally unable to see.
    expect(OPERATOR_STEP_LABELS.issue_final).toContain("키가 발급되지 않고");
    expect(OPERATOR_STEP_LABELS.issue_final).toContain("확인할 수 없습니다");
  });

  it("the method step says WHO chooses, and does not offer the option the walk does not guide", () => {
    expect(OPERATOR_STEP_LABELS.vendor_method).toContain("SellerOps는 선택하지 않습니다");
    // `연동업체 선택` is measured to the same standard and deliberately not named: the walk guides one method.
    expect(OPERATOR_STEP_LABELS.vendor_method).not.toContain("연동업체");
  });

  it("**the manifest's own step list ends at the key, not before it**", () => {
    // This paragraph is what the operator reads in the Approval Manifest, and it is what the grant binds to.
    // Every OTHER description of the walk was updated when the walk grew; this one still ended "⑤ 여기서
    // 멈춥니다" and promised the 발급받기 button would never be pressed — a manifest understating its own run,
    // which is the one direction that must never pass silently. Nothing failed, because nothing checked it.
    const summary = PHASE_ENTRYPOINTS.COUPANG_WING_GUIDED_ISSUANCE_WALK.operatorActionSummary;
    for (const stale of ["⑤ 여기서 멈춥니다", "이번 run에서는 절대 누르지 않습니다", "이번 승인 범위에 포함되지 않습니다"]) {
      expect(summary, `the manifest must not still say "${stale}"`).not.toContain(stale);
    }
    // It must reach the control with the consequence, and say the consequence.
    expect(summary).toContain("실제 API 키가 발급되어 라이브 계정 상태가 바뀝니다");
    expect(summary).toContain("별도의 삭제 작업으로 지울 수 있습니다");
    expect(summary).not.toContain("되돌릴 수 없");
    expect(summary).toContain(WING_VENDOR_METHOD_PRODUCT_DECISION.method);
    // …and keep the two attributions the audit installed: the earlier press is a REPORT, and so is the
    // consequence of the later one — this run is what verifies the latter.
    expect(summary).toContain("측정이 아닙니다");
    expect(summary).toContain("이번 run이 그것을");
    // The agent's own budget stays zero in the same breath as the press it is asking for.
    expect(summary).toContain("절대 누르지 않으며");
    expect(summary).toContain("입력란에 아무것도 쓰지 않습니다");
  });
});
