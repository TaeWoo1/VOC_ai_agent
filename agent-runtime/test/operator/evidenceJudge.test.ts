/**
 * The Evidence Judge — and the direction it falls when it fails.
 *
 * The property that matters most here is not "the judge is right". It is that a judge outage makes the
 * Operator QUIETER, never bolder: the rule judge answers when the model cannot, the model may withhold
 * a finding but may not release one the rules refused, and a finding with no verdict at all is shown as
 * "확인 필요" rather than asserted or dropped.
 */
import { describe, expect, it } from "vitest";
import {
  confidenceOf,
  RuleEvidenceJudge,
  SpringEvidenceJudge,
} from "../../src/operator/judge/EvidenceJudge";
import type { EvidenceRef, Finding } from "../../src/operator/state/OperatorState";
import type { AgentJudgeView } from "../../src/spring/types";

function ref(overrides: Partial<EvidenceRef> = {}): EvidenceRef {
  return {
    evidenceId: "e1",
    kind: "REVIEW_ISSUE",
    sourceTool: "search_review_issues",
    sourceCall: "abc12345",
    locator: { count: 12, label: "접착 탈락", severity: "HIGH" },
    observedOn: "2026-08-14",
    coverage: "COVERED",
    provenance: "issue-memory/RULE_BASED",
    ...overrides,
  };
}

function finding(statement: string, evidenceIds = ["e1"]): Finding {
  return {
    findingId: "f1",
    specialist: "REVIEW_OPS",
    statement,
    evidenceIds,
    confidence: "NEEDS_REVIEW",
    verdict: null,
    surfaceLink: null,
  };
}

describe("RuleEvidenceJudge", () => {
  const judge = new RuleEvidenceJudge();

  it("evidence from an UNCERTAIN source does not support a claim", async () => {
    const verdict = await judge.judge(
      finding("이 상품에는 문제가 없습니다."),
      [ref({ coverage: "UNCERTAIN_PRODUCT_UNLINKED", locator: { count: 0 } })],
    );

    expect(verdict.hasEvidence, "an unlinked source is a blind spot, not a measured zero").toBe(false);
    expect(verdict.supportingEvidenceIds).toEqual([]);
    expect(confidenceOf(verdict)).toBe("UNSUPPORTED");
  });

  it("refuses an explicit causal claim, whatever the evidence behind it", async () => {
    const verdict = await judge.judge(finding("접착 불량 때문에 반품이 늘었습니다."), [ref()]);

    expect(verdict.unsafeAssertion).toBe(true);
    expect(verdict.unsafeReason).toContain("원인 단정");
    expect(confidenceOf(verdict), "shown as something to check, not asserted").toBe("NEEDS_REVIEW");
  });

  it("refuses a performance claim — the rule pages-copy.test.ts already enforces on screen", async () => {
    const verdict = await judge.judge(finding("이번 조치로 매출이 좋아졌습니다."), [ref()]);

    expect(verdict.unsafeAssertion).toBe(true);
    expect(verdict.unsafeReason).toContain("성과 주장");
  });

  it("refuses a trend claim standing on one or two data points", async () => {
    const thin = await judge.judge(
      finding("접착 문제가 늘고 있습니다."),
      [ref({ locator: { count: 2 } })],
    );
    const thick = await judge.judge(
      finding("접착 문제가 늘고 있습니다."),
      [ref({ locator: { count: 12 } })],
    );

    expect(thin.unsafeReason, "two occurrences is a story, not a trend").toContain("과일반화");
    expect(thick.unsafeAssertion).toBe(false);
  });

  it("refuses '이번 주' over evidence that carries no date", async () => {
    const verdict = await judge.judge(
      finding("이번 주 미답변 문의는 3,208건입니다."),
      [ref({ kind: "INBOX_COUNT", observedOn: null, locator: { count: 3208 } })],
    );

    expect(verdict.unsafeReason).toContain("기간");
  });

  it("KNOWN LIMIT: a -어서 causal sentence passes the rule judge", async () => {
    // Recorded rather than hidden. Matching the -아서/-어서 connective would also catch "확인해서",
    // "정리해서" — ordinary sequencing — so the deterministic judge stops at explicit markers and the
    // LLM judge is the wider net. The sentence is still bounded by the evidence and trend rules.
    const wellEvidenced = await judge.judge(finding("접착이 약해서 반품이 늘었습니다."), [ref()]);
    const thin = await judge.judge(
      finding("접착이 약해서 반품이 늘었습니다."),
      [ref({ locator: { count: 1 } })],
    );

    expect(wellEvidenced.unsafeReason, "the causal half is NOT caught by the rules").toBeNull();
    expect(thin.unsafeReason, "but the trend half still is, on thin evidence").toContain("과일반화");
  });

  it("passes an ordinary, dated, well-evidenced statement", async () => {
    const verdict = await judge.judge(
      finding('"접착 탈락"에 대한 리뷰 근거가 12건 기록돼 있습니다.'),
      [ref()],
    );

    expect(verdict.hasEvidence).toBe(true);
    expect(verdict.unsafeAssertion).toBe(false);
    expect(confidenceOf(verdict)).toBe("SUPPORTED");
    expect(verdict.judgeKind).toBe("RULE_BASED");
  });
});

describe("SpringEvidenceJudge — fail closed, and only ever quieter", () => {
  const good = finding('"접착 탈락"에 대한 리뷰 근거가 12건 기록돼 있습니다.');

  it("a backend with no judge endpoint falls back to the rule judge", async () => {
    const verdict = await new SpringEvidenceJudge({}).judge(good, [ref()]);

    expect(verdict.judgeKind).toBe("RULE_BASED");
    expect(verdict.hasEvidence).toBe(true);
  });

  it("a transport failure falls back rather than failing the run", async () => {
    const judge = new SpringEvidenceJudge({
      judgeFinding: async () => {
        throw new Error("connection refused");
      },
    });

    const verdict = await judge.judge(good, [ref()]);
    expect(verdict.judgeKind).toBe("RULE_BASED");
  });

  it("capability off falls back", async () => {
    const off: AgentJudgeView = {
      available: false, hasEvidence: false, supportingEvidenceIds: [], unsafeAssertion: false,
      unsafeReason: null, needsMore: false, needsMoreTool: null, needsMoreReason: null,
      providerVersion: null,
    };
    const verdict = await new SpringEvidenceJudge({ judgeFinding: async () => off }).judge(good, [ref()]);

    expect(verdict.judgeKind).toBe("RULE_BASED");
  });

  it("the model may WITHHOLD a finding the rules allowed", async () => {
    const withheld: AgentJudgeView = {
      available: true, hasEvidence: false, supportingEvidenceIds: [], unsafeAssertion: true,
      unsafeReason: "근거가 문장을 뒷받침하지 않음", needsMore: false, needsMoreTool: null,
      needsMoreReason: null, providerVersion: "agent-judge/v1+test",
    };

    const verdict = await new SpringEvidenceJudge({ judgeFinding: async () => withheld })
      .judge(good, [ref()]);

    expect(verdict.hasEvidence).toBe(false);
    expect(confidenceOf(verdict)).toBe("UNSUPPORTED");
  });

  it("the model may NOT release a finding the rules refused", async () => {
    const permissive: AgentJudgeView = {
      available: true, hasEvidence: true, supportingEvidenceIds: ["e1"], unsafeAssertion: false,
      unsafeReason: null, needsMore: false, needsMoreTool: null, needsMoreReason: null,
      providerVersion: "agent-judge/v1+test",
    };

    // A causal claim: the rules refuse it, and the model saying it is fine must not override that.
    const verdict = await new SpringEvidenceJudge({ judgeFinding: async () => permissive })
      .judge(finding("접착 불량 때문에 반품이 늘었습니다."), [ref()]);

    expect(verdict.unsafeAssertion, "the rules encode commitments the product already made").toBe(true);
    expect(confidenceOf(verdict)).toBe("NEEDS_REVIEW");
  });

  it("the digest that leaves carries metadata only — never a sentence", async () => {
    const digests: string[] = [];
    const judge = new SpringEvidenceJudge({
      judgeFinding: async (request) => {
        digests.push(request.evidenceDigest);
        return {
          available: true, hasEvidence: true, supportingEvidenceIds: ["e1"], unsafeAssertion: false,
          unsafeReason: null, needsMore: false, needsMoreTool: null, needsMoreReason: null,
          providerVersion: "v",
        };
      },
    });

    await judge.judge(good, [ref()]);

    expect(digests).toHaveLength(1);
    for (const line of digests[0]!.split("\n")) {
      for (const token of line.trim().split(/\s+/)) {
        expect(token, `"${token}" is not key=value metadata`).toMatch(/^[A-Za-z0-9_-]+(=[^\s]*)?$/);
      }
    }
  });
});

describe("confidenceOf", () => {
  it("a missing verdict is NEEDS_REVIEW — never silently dropped, never asserted", () => {
    expect(confidenceOf(null)).toBe("NEEDS_REVIEW");
  });
});
