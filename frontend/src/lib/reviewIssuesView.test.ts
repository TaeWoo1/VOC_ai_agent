import { describe, it, expect } from "vitest";
import type { IssueChangeView, IssueEvidenceView, ReviewIssueView } from "./types";
import {
  CHANGE_EXPLANATION_KO,
  CHANGE_ORDER,
  CHANGE_TONE,
  changeBadges,
  changedIssues,
  improvedIssues,
  investigationHintKo,
  issuesSummary,
  nextActionKo,
  productLineKo,
  provenanceKo,
  renderableQuotes,
  steadyIssues,
  suppressedQuoteCount,
  surgeLine,
  waitingNoteKo,
} from "./reviewIssuesView";

function change(partial: Partial<IssueChangeView> = {}): IssueChangeView {
  return {
    kinds: [],
    labelsKo: [],
    highSurge: false,
    surgeWindowCount: 0,
    surgeBaselineWeekly: 0,
    ...partial,
  };
}

function issue(partial: Partial<ReviewIssueView> = {}): ReviewIssueView {
  return {
    id: "issue-1",
    title: "배송 지연",
    aspect: "배송",
    problem: "지연",
    severity: "NORMAL",
    lifecycleState: "OBSERVING",
    lifecycleLabelKo: "관찰 중",
    evidenceCount: 3,
    firstEvidenceOn: "2026-07-01",
    lastEvidenceOn: "2026-07-25",
    dominantProductId: null,
    dominantProductName: null,
    dismissed: false,
    extractorKind: "RULE_BASED",
    change: change(),
    ...partial,
  };
}

describe("change badges", () => {
  it("covers every judgement with a tone and an explanation", () => {
    for (const kind of CHANGE_ORDER) {
      expect(CHANGE_TONE[kind]).toBeTruthy();
      expect(CHANGE_EXPLANATION_KO[kind]).toBeTruthy();
    }
  });

  it("prefers the server's own labels so a client cannot invent a fifth category", () => {
    const badges = changeBadges(
      change({ kinds: ["SURGING"], labelsKo: ["서버가 보낸 라벨"] }),
    );
    expect(badges).toHaveLength(1);
    expect(badges[0]!.labelKo).toBe("서버가 보낸 라벨");
  });

  /** A blank badge is the one outcome that tells the operator nothing at all. */
  it("falls back to a local label rather than rendering nothing", () => {
    const badges = changeBadges(change({ kinds: ["CONCENTRATED"], labelsKo: [] }));
    expect(badges[0]!.labelKo).toBe("특정 상품 집중");
  });

  it("only improvement reads as good news", () => {
    expect(CHANGE_TONE.IMPROVED).toBe("good");
    expect(CHANGE_TONE.NEW).toBe("bad");
    expect(CHANGE_TONE.SURGING).toBe("bad");
  });
});

describe("the quantified surge line", () => {
  it("is absent when no surge fired", () => {
    expect(surgeLine(change({ kinds: ["PERSISTENT"] }))).toBeNull();
  });

  it("quotes both the current count and the weekly baseline", () => {
    const line = surgeLine(
      change({ kinds: ["SURGING"], surgeWindowCount: 9, surgeBaselineWeekly: 2.125 }),
    );
    expect(line).toBe("최근 7일 9건 · 이전 8주 평균 주 2.1건");
  });

  /** "주 0건" beside a surge reads as a contradiction; the truth is "under one a week". */
  it("never rounds a real baseline down to zero", () => {
    const line = surgeLine(
      change({ kinds: ["SURGING"], surgeWindowCount: 4, surgeBaselineWeekly: 0.05 }),
    );
    expect(line).toContain("주 1건 미만");
    expect(line).not.toContain("주 0.0건");
  });

  it("shows a low but representable baseline as a number", () => {
    const line = surgeLine(
      change({ kinds: ["SURGING"], surgeWindowCount: 4, surgeBaselineWeekly: 0.5 }),
    );
    expect(line).toBe("최근 7일 4건 · 이전 8주 평균 주 0.5건");
  });
});

describe("what the operator can do next", () => {
  /**
   * <b>Rewritten when OBSERVING became a state a seller may start from</b> (product-owner decision,
   * 2026-09-13). The claim this replaced — 조치 시작 only from 확인 필요 — was the contract, and it
   * made a seller's ability to record a decision depend on an automatic rule having fired first. On
   * evidence too sparse for any rule, that meant never: measured on the demo org, all 25 issues sat
   * in OBSERVING and the control appeared on none of them.
   *
   * What survives is the shape of the fence: the two states a person may start from are stated here
   * and refused server-side by `IssueLifecycleState.sellerMayStartActing()`, and the two where
   * remediation is already recorded stay closed.
   */
  it("offers 조치 시작 from the two states before work has been recorded", () => {
    expect(nextActionKo("OBSERVING")).toBe("조치 시작");
    expect(nextActionKo("NEEDS_REVIEW")).toBe("조치 시작");
    // Remediation is already recorded in both; restarting would overwrite it with an assertion.
    expect(nextActionKo("VERIFYING")).toBeNull();
    expect(nextActionKo("RESOLVED")).toBeNull();
  });

  it("offers 조치 완료로 기록 only from 조치 중", () => {
    expect(nextActionKo("ACTING")).toBe("조치 완료로 기록");
  });

  /**
   * 해결됨 is reached by observing quiet weeks after recorded remediation. A button anywhere would
   * let an assertion stand in for evidence.
   */
  it("never offers a way to declare an issue resolved", () => {
    const actions = (["OBSERVING", "NEEDS_REVIEW", "ACTING", "VERIFYING", "RESOLVED"] as const)
      .map(nextActionKo)
      .filter((a): a is string => a !== null);
    expect(actions.some((a) => a.includes("해결"))).toBe(false);
  });

  /**
   * The note is now reviewnary's own position, rendered BESIDE whatever the seller may do rather
   * than instead of it — so on OBSERVING both a sentence and a button appear, and the seller can see
   * they are acting ahead of the system rather than being told to wait.
   */
  it("states reviewnary's own position, including where the seller may still act", () => {
    expect(waitingNoteKo("OBSERVING")).toContain("먼저 확인을 권할 만큼");
    expect(nextActionKo("OBSERVING")).not.toBeNull();
    expect(waitingNoteKo("VERIFYING")).toContain("지켜보고 있어요");
    expect(waitingNoteKo("NEEDS_REVIEW")).toBeNull();
  });

  /** 해결됨 is an observation of silence, not proof the problem is gone. */
  it("describes 해결됨 as an observation rather than a disappearance", () => {
    const note = waitingNoteKo("RESOLVED")!;
    expect(note).toContain("확인되지 않아");
    expect(note).not.toContain("사라졌");
    expect(note).not.toContain("완전히");
  });
});

describe("product attribution", () => {
  it("is absent when nothing is attributable", () => {
    expect(productLineKo(issue())).toBeNull();
    expect(investigationHintKo(issue())).toBeNull();
  });

  it("says 집중 only when the concentration judgement fired", () => {
    const concentrated = issue({
      dominantProductName: "몰딩 A",
      change: change({ kinds: ["CONCENTRATED"] }),
    });
    expect(productLineKo(concentrated)).toBe("몰딩 A에 집중");
    expect(productLineKo(issue({ dominantProductName: "몰딩 A" }))).toBe("주로 몰딩 A");
  });

  /** The single easiest way this product could mislead a seller is by naming a cause. */
  it("suggests what to check and never names a cause", () => {
    const hint = investigationHintKo(
      issue({ dominantProductName: "몰딩 A", change: change({ kinds: ["CONCENTRATED"] }) }),
    )!;
    expect(hint).toContain("먼저 확인해 보세요");
    expect(hint).not.toContain("원인");
    expect(hint).not.toContain("때문");
  });

  it("has no hint without a concentration verdict, even with a dominant product", () => {
    expect(investigationHintKo(issue({ dominantProductName: "몰딩 A" }))).toBeNull();
  });
});

describe("grouping and counts", () => {
  const list = [
    issue({ id: "a", change: change({ kinds: ["SURGING"] }) }),
    issue({ id: "b", lifecycleState: "NEEDS_REVIEW", change: change({ kinds: ["NEW"] }) }),
    issue({ id: "c", change: change({ kinds: ["IMPROVED"] }) }),
    issue({ id: "d" }),
  ];

  it("counts what the header claims", () => {
    expect(issuesSummary(list)).toEqual({
      total: 4,
      needsReview: 1,
      changed: 2,
      improved: 1,
    });
  });

  /** The header is a call to look, and good news is not one. */
  it("does not count an improvement as a change to look at", () => {
    expect(issuesSummary([issue({ change: change({ kinds: ["IMPROVED"] }) })]).changed).toBe(0);
  });

  it("splits the three groups without overlap or loss", () => {
    const changed = changedIssues(list).map((i) => i.id);
    const improved = improvedIssues(list).map((i) => i.id);
    const steady = steadyIssues(list).map((i) => i.id);
    expect(changed).toEqual(["a", "b"]);
    expect(improved).toEqual(["c"]);
    expect(steady).toEqual(["d"]);
  });

  it("puts an issue that both surged and improved in both lists rather than dropping it", () => {
    const both = [issue({ id: "x", change: change({ kinds: ["SURGING", "IMPROVED"] }) })];
    expect(changedIssues(both)).toHaveLength(1);
    expect(improvedIssues(both)).toHaveLength(1);
    expect(steadyIssues(both)).toHaveLength(0);
  });
});

describe("evidence quotes", () => {
  function evidence(quote: string | null): IssueEvidenceView {
    return {
      reviewId: "r",
      unitOrdinal: 0,
      occurredOn: "2026-07-25",
      productId: null,
      productName: null,
      rating: 5,
      quote,
    };
  }

  /** An empty quote would put words the customer never said inside quotation marks. */
  it("drops suppressed and blank quotes instead of rendering empty ones", () => {
    const quotes = renderableQuotes([
      evidence("배송이 늦었어요"),
      evidence(null),
      evidence("   "),
      evidence("색상이 달라요"),
    ]);
    expect(quotes).toEqual(["배송이 늦었어요", "색상이 달라요"]);
  });

  it("respects the limit", () => {
    const rows = [evidence("하나"), evidence("둘"), evidence("셋"), evidence("넷")];
    expect(renderableQuotes(rows, 2)).toEqual(["하나", "둘"]);
  });

  /** If most evidence is unquotable, the operator should know the list is partial. */
  it("reports how many quotes were suppressed", () => {
    expect(suppressedQuoteCount([evidence("있음"), evidence(null), evidence("")])).toBe(2);
  });

  it("handles an issue with no evidence at all", () => {
    expect(renderableQuotes([])).toEqual([]);
    expect(suppressedQuoteCount([])).toBe(0);
  });
});

describe("provenance", () => {
  /** It is rule-based, and nothing in the product may call it AI. */
  it("says 규칙 기반 and never AI", () => {
    const line = provenanceKo(issue());
    expect(line).toContain("규칙 기반");
    expect(line).toContain("최종 진단이 아닙니다");
    expect(line).not.toContain("AI");
  });

  it("still refuses to claim a diagnosis for an unknown extractor", () => {
    const line = provenanceKo(issue({ extractorKind: "SOMETHING_ELSE" }));
    expect(line).toContain("최종 진단이 아닙니다");
    expect(line).not.toContain("AI");
  });
});
