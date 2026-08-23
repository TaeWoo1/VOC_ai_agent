/**
 * The Evidence Judge: may this sentence be said, and on what.
 *
 * Two implementations behind one interface, and the relationship between them is the design:
 *
 * - {@link RuleEvidenceJudge} is deterministic, always available, and CONSERVATIVE. It can withhold a
 *   finding; it can never approve one the model would have refused on grounds the rules do not model.
 * - {@link SpringEvidenceJudge} asks the backend's judge capability and falls back to the rule judge on
 *   every failure — off for the org, no endpoint, transport error, refusal, off-schema.
 *
 * So the judge going away makes the Operator QUIETER, never bolder. That direction is not an
 * accident; it is the only direction a fail-closed component may fall.
 *
 * Every verdict carries its own `judgeKind`, so a surface says which judge spoke instead of assuming —
 * the same rule `draftKindLabel` follows for drafts.
 */
import type { EvidenceRef, Finding, JudgeVerdict } from "../state/OperatorState";
import type { NeedScope } from "../scope/EvidenceScope";
import { checkEvidence } from "../scope/EvidenceScope";
import { digestFor } from "../state/evidence";
import type { AgentJudgeView } from "../../spring/types";
import { log } from "../../log";

export interface EvidenceJudge {
  readonly kind: "LLM" | "RULE_BASED";
  /**
   * Whether this judge will actually reach a model.
   *
   * Separate from {@link kind} because they answer different questions. `kind` is what the judge IS;
   * this is what it will DO on the next call. A {@link SpringEvidenceJudge} pointed at a backend with
   * no judge endpoint is an LLM judge that makes no model call — and a caller that charged the model
   * budget for it would exhaust a run on calls that never happened, ending it early with `verdict:
   * null` on findings nothing was ever going to judge.
   */
  readonly usesModel: boolean;
  /**
   * @param scope the evidence-scope contract for the need this finding answers, when the caller knows
   *     it. Optional so that every existing caller and test still compiles — but when it IS passed,
   *     scope-incompatible citations stop supporting the sentence. See `EvidenceScope.ts`.
   */
  judge(finding: Finding, evidence: readonly EvidenceRef[], scope?: NeedScope): Promise<JudgeVerdict>;
}

/** The backend call this judge needs. Structural, so any client that has it fits. */
export interface JudgeBackend {
  judgeFinding?(request: { finding: string; evidenceDigest: string }): Promise<AgentJudgeView>;
}

const RULE_VERSION = "operator-judge-rules/v1";

/**
 * Deterministic judging over the four questions the contract names.
 *
 * <b>The unsafe-assertion checks are the ones this repository has already had to make elsewhere.</b>
 * Causal language is refused because {@code ReviewIssueView} refuses it ("이슈 후보이지 진단이 아니다");
 * performance claims are refused because `pages-copy.test.ts` refuses them on screen; over-generalizing
 * from thin evidence is refused because the issue memory's own thresholds exist for that reason. This
 * judge is those rules applied to a sentence instead of a surface.
 */
export class RuleEvidenceJudge implements EvidenceJudge {
  readonly kind = "RULE_BASED" as const;
  readonly usesModel = false;

  /** Below this, "늘고 있다 / 반복된다" is a story about two data points. */
  private static readonly MIN_EVIDENCE_FOR_TREND = 3;

  /**
   * Explicit causal markers.
   *
   * <b>Deliberately explicit, and this is a known limit rather than an oversight.</b> Korean marks
   * cause with the {@code -아서/-어서} connective too ("접착이 약해서 반품이 늘었습니다"), and matching
   * that lexically would also catch "확인해서", "정리해서", "비교해서" — ordinary sequencing, not a
   * claim. A rule that refused those would be a rule people route around. So the deterministic judge
   * catches the unambiguous forms and the LLM judge (which reads the sentence) is the wider net; when
   * the LLM judge is off, a {@code -어서} causal sentence can pass this check and is still bounded by
   * the evidence requirement and by the over-generalization rule.
   */
  private static readonly CAUSAL = ["때문", "원인은", "원인이", "탓", "로 인해", "로 인한", "때문에"];
  private static readonly PERFORMANCE = ["매출", "전환율", "좋아졌", "개선됐", "향상", "성과"];
  /** Past tense counts too: "늘었습니다" is the same claim as "늘고 있습니다", made about last week. */
  private static readonly TREND = ["늘고", "늘었", "증가", "반복", "악화", "줄고", "줄었", "감소"];
  private static readonly BLAME = ["고객 잘못", "사용자 과실", "고객이 잘못"];
  private static readonly PERIOD = ["이번 주", "금주", "이번주"];

  async judge(
    finding: Finding,
    evidence: readonly EvidenceRef[],
    scope?: NeedScope,
  ): Promise<JudgeVerdict> {
    const cited = evidence.filter((e) => finding.evidenceIds.includes(e.evidenceId));
    // Evidence from a source that could not answer for the scope does NOT support a claim. This is the
    // whole point of carrying coverage on the ref: an empty count under UNCERTAIN_PRODUCT_UNLINKED is a
    // blind spot, and a judge that counted it would approve "문제 없습니다" on the strength of it.
    // A finding whose claim IS the blind spot is supported BY the uncertain evidence, not undermined by
    // it. Everything else is judged only on evidence whose source could actually answer.
    // Evidence whose SCOPE does not match the need's does not support the claim either — the same
    // shape of rule as the coverage filter above, and the safety floor under the graph's own gate
    // (`operatorGraph.applyScopeGate`). Two independent checks, deliberately: a finding that reached
    // this judge past the gate must still not be approved on evidence about something else.
    const inScope = scope && !finding.claimsCoverageLimit
      ? cited.filter((e) => checkEvidence(scope, e) === null)
      : cited;
    const usable = finding.claimsCoverageLimit ? inScope : inScope.filter((e) => e.coverage === "COVERED");
    const statement = finding.statement;

    const reasons: string[] = [];
    if (RuleEvidenceJudge.CAUSAL.some((k) => statement.includes(k))) {
      reasons.push("원인 단정");
    }
    if (RuleEvidenceJudge.BLAME.some((k) => statement.includes(k))) {
      reasons.push("고객 책임 단정");
    }
    if (RuleEvidenceJudge.PERFORMANCE.some((k) => statement.includes(k))) {
      reasons.push("성과 주장");
    }
    if (RuleEvidenceJudge.TREND.some((k) => statement.includes(k))) {
      const total = usable.reduce((sum, e) => sum + (e.locator.count ?? 0), 0);
      if (total < RuleEvidenceJudge.MIN_EVIDENCE_FOR_TREND) {
        reasons.push("근거 대비 과일반화");
      }
    }
    if (RuleEvidenceJudge.PERIOD.some((k) => statement.includes(k))
        && usable.every((e) => e.observedOn == null)) {
      reasons.push("기간 미표기 총계를 기간 주장으로 사용");
    }

    return {
      hasEvidence: usable.length > 0,
      supportingEvidenceIds: usable.map((e) => e.evidenceId),
      unsafeAssertion: reasons.length > 0,
      unsafeReason: reasons.length > 0 ? reasons.join(", ") : null,
      // The rule judge never asks for more: it has no view of what another read would show, and a
      // fabricated "look again" would spend budget on a guess.
      needsMore: false,
      needsMoreTool: null,
      needsMoreReason: null,
      judgeKind: this.kind,
      judgeVersion: RULE_VERSION,
    };
  }
}

/**
 * The LLM judge, with the rule judge underneath it.
 *
 * The digest it sends is metadata only ({@link digestFor}), and the backend refuses the request
 * outright if it is not — two checks on the same property, one on each side of the hop, because this
 * is the one Operator payload that is assembled rather than structurally bounded.
 */
export class SpringEvidenceJudge implements EvidenceJudge {
  readonly kind = "LLM" as const;

  /** Set once the backend answers `available: false` — the capability is off for this org. */
  private capabilityOff = false;

  constructor(
    private readonly backend: JudgeBackend,
    private readonly fallback: EvidenceJudge = new RuleEvidenceJudge(),
  ) {}

  /**
   * Whether the NEXT call will reach a model.
   *
   * <b>It stops being true once the backend says the capability is off.</b> The seam existing and the
   * capability being enabled for this org are different facts, and only the second one costs a model
   * call. Measured live 2026-08-21: with plan and judge off, a run still spent 5 of its 6 model-budget
   * units on round-trips that every time returned `available: false` and fell through to the rule
   * judge — so a run with a couple more findings would have "exhausted" a budget it never used, and
   * left real findings unjudged. Asking once per run is diagnosis; asking once per finding is waste.
   */
  get usesModel(): boolean {
    return !this.capabilityOff && typeof this.backend.judgeFinding === "function";
  }

  async judge(
    finding: Finding,
    evidence: readonly EvidenceRef[],
    scope?: NeedScope,
  ): Promise<JudgeVerdict> {
    const rule = await this.fallback.judge(finding, evidence, scope);
    // `usesModel` gates the BUDGET; this gates the CALL. Both must read the learned state, or the run
    // stops paying for round-trips it nevertheless keeps making.
    if (!this.usesModel || !this.backend.judgeFinding) {
      // A backend predating the endpoint, or a fake. Indistinguishable from "off" to the graph, and it
      // should be: both mean "no model judgement", and both leave the conservative verdict standing.
      return rule;
    }
    const cited = evidence.filter((e) => finding.evidenceIds.includes(e.evidenceId));
    let view: AgentJudgeView;
    try {
      view = await this.backend.judgeFinding({
        finding: finding.statement,
        evidenceDigest: digestFor(cited),
      });
    } catch {
      // The error is not inspected or logged: a backend error can quote the request.
      log("operator_judge", { judgeKind: "RULE_BASED", modelAnswered: false, reason: "TRANSPORT" });
      return rule;
    }
    if (!view.available) {
      // `providerVersion` present ⇒ the capability is ON and the model declined this one finding, which
      // says nothing about the next. Absent ⇒ it is off for this org, and every further ask this run
      // would get the same answer, so stop asking.
      if (!view.providerVersion) {
        this.capabilityOff = true;
      }
      log("operator_judge", {
        judgeKind: "RULE_BASED",
        modelAnswered: false,
        reason: view.providerVersion ? "MODEL_DECLINED" : "CAPABILITY_OFF",
      });
      return rule;
    }
    log("operator_judge", {
      judgeKind: "LLM",
      modelAnswered: true,
      hasEvidence: view.hasEvidence,
      unsafe: view.unsafeAssertion,
    });
    return {
      // AND with the rule verdict, never OR. The model may withhold a finding the rules would allow;
      // it may not release one the rules refused, because the rules encode commitments the product
      // has already made on screen and a model is not the place to reopen them.
      hasEvidence: view.hasEvidence && rule.hasEvidence,
      supportingEvidenceIds: view.supportingEvidenceIds.filter((id) =>
        rule.supportingEvidenceIds.includes(id),
      ),
      unsafeAssertion: view.unsafeAssertion || rule.unsafeAssertion,
      unsafeReason: view.unsafeReason ?? rule.unsafeReason,
      needsMore: view.needsMore,
      needsMoreTool: view.needsMoreTool,
      needsMoreReason: view.needsMoreReason,
      judgeKind: this.kind,
      judgeVersion: view.providerVersion ?? "agent-judge/v1",
    };
  }
}

/**
 * The verdict → confidence mapping, in one place.
 *
 * Three outcomes and not a score: `SUPPORTED` may be said, `NEEDS_REVIEW` is shown as something to
 * check rather than as a claim, `UNSUPPORTED` is not presented as a finding at all. An unsafe
 * assertion is never dropped silently — it is demoted, so the operator still sees that something is
 * there and sees why it is not being asserted.
 */
export function confidenceOf(verdict: JudgeVerdict | null): "SUPPORTED" | "NEEDS_REVIEW" | "UNSUPPORTED" {
  if (!verdict) {
    // No verdict at all (the judge itself failed) is NEEDS_REVIEW, not UNSUPPORTED: withholding what
    // was actually read would be its own kind of dishonesty. It is shown as "확인 필요".
    return "NEEDS_REVIEW";
  }
  if (!verdict.hasEvidence) {
    return "UNSUPPORTED";
  }
  return verdict.unsafeAssertion ? "NEEDS_REVIEW" : "SUPPORTED";
}
