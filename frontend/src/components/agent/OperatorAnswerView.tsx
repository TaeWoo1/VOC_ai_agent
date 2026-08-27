import { Link } from "react-router-dom";
import { answerObjects, answerObjectHref } from "../../lib/answerObjects";
import type { OperatorAnswer } from "../../lib/agentRuntime/types";

/**
 * The Agent's answer as the objects it cites — shared by the `/agent` page and the contextual panel
 * (Contextual Agent Workspace v1). Moved out of `pages/Agent.tsx` unchanged so the two surfaces cannot
 * drift: one answer, one rendering.
 */
/**
 * 운영 판단 — the Operator's answer.
 *
 * Three rules this card exists to keep, each of them a rule the product has already had to learn:
 *
 * 1. <b>A statement is shown with its evidence, or not at all.</b> Every finding renders the evidence
 *    it cites, and the evidence renders where it came from. A number with no traceable source is the
 *    thing this whole design is built to avoid.
 * 2. <b>확인 필요 is not 확인됨.</b> A `NEEDS_REVIEW` finding is labelled and styled as something to
 *    check, never as an assertion. The judge's reason is printed when there is one, because "왜 이건
 *    확정이 아닌가"는 셀러가 물을 첫 질문이다.
 * 3. <b>판단 불가 is not 문제 없음.</b> A coverage row that is not COVERED renders an explicit notice,
 *    the same decline-to-answer the review attention surface renders instead of an empty state.
 *
 * No customer 원문 appears here and none can: the answer's own types cannot carry one.
 */
export function OperatorAnswerView({ answer, compact = false }: { answer: OperatorAnswer; compact?: boolean }) {
  const evidenceById = new Map(answer.evidence.map((e) => [e.evidenceId, e]));
  const uncertain = answer.coverage.filter((c) => c.coverage !== "COVERED");
  // SIGNALS is the attribution axis and is already covered by `uncertain` above; repeating it here
  // would print the same limitation twice under two different headings.
  const missingKnowledge = (answer.knowledgeCoverage ?? []).filter(
    (c) => c.facet !== "SIGNALS" && (c.coverage === "UNAVAILABLE" || c.coverage === "STALE"),
  );
  // What the answer is ABOUT, as things the seller can open (§8). Read off the evidence that is
  // already on this card — no second request, no derived number, and nothing when the answer was
  // org-wide, because then there is no object to offer.
  const objects = answerObjects(answer.evidence);

  return (
    <section className={compact ? "rounded-lg border border-line bg-surface p-3" : "mt-4 rounded-lg border border-line bg-surface p-4"}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-bold text-ink">운영 판단</h3>
        <span className="text-xs text-muted">
          {/*
            One planner, so one label — and it is still read from the run rather than written here, the
            same rule draftKindLabel follows. The "규칙 해석" branch is gone with the deterministic
            planner it described: under Operator Graph v2 a run either had an AI plan or it FAILED, so a
            rendered answer can only have been interpreted one way.
          */}
          AI 해석 · 조회 {answer.budget.toolCalls}회
        </span>
      </header>

      {answer.clarification ? (
        // Asking back IS the answer. Rendering it as "found nothing" would hide a question the seller
        // can actually resolve in one sentence.
        <div className="mt-3 rounded border border-brand/40 bg-brand-50 p-3">
          <p className="break-keep leading-relaxed text-ink">{answer.clarification}</p>
        </div>
      ) : null}

      {answer.needs.length > 0 ? <InvestigationPlanList needs={answer.needs} /> : null}

      {answer.findings.length === 0 && !answer.clarification ? (
        <p className="mt-3 text-muted">{answer.note ?? "말씀드릴 만한 것을 찾지 못했습니다."}</p>
      ) : answer.findings.length === 0 ? null : (
        <ul className="mt-3 space-y-3">
          {answer.findings.map((finding) => (
            <li key={finding.findingId} className="rounded border border-line bg-canvas p-3">
              <div className="flex items-start gap-2">
                <span
                  className={
                    finding.confidence === "SUPPORTED"
                      ? "mt-0.5 shrink-0 rounded-full bg-good/10 px-2 py-0.5 text-xs font-medium text-good"
                      : "mt-0.5 shrink-0 rounded-full bg-warn/10 px-2 py-0.5 text-xs font-medium text-warn"
                  }
                >
                  {finding.confidence === "SUPPORTED" ? "확인됨" : "확인 필요"}
                </span>
                <p className="break-keep leading-relaxed text-ink">{finding.statement}</p>
              </div>

              {finding.verdict?.unsafeReason ? (
                <p className="mt-2 text-xs text-muted">
                  단정하지 않은 이유: {finding.verdict.unsafeReason}
                </p>
              ) : null}

              <ul className="mt-2 space-y-1">
                {finding.evidenceIds.map((id) => {
                  const ref = evidenceById.get(id);
                  if (!ref) return null;
                  return (
                    /*
                      What was checked, in the seller's words (Core Daily Loop UX Integration v1 §4).

                      This line used to open with the internal evidence id and close with the raw
                      provenance string — 「근거 e1 · … · inbox/SERVER:unansweredInquiries」. Neither is
                      something a seller acts on, and the second is the name of a call. `kind` was the
                      fallback label and is a storage enum for the same reason. What survives is what
                      was read, how much of it, when, and whether any of it could not be judged.
                    */
                    <li key={id} className="text-xs text-muted">
                      {ref.locator.label ?? "확인한 자료"}
                      {ref.locator.count != null ? ` ${ref.locator.count}건` : ""}
                      {ref.events ? ` · ${ref.events.from ?? "?"}~${ref.events.to ?? "?"} 발생` : ""}
                      {ref.asOf ? ` · ${ref.asOf} 확인` : ""}
                      {ref.coverage !== "COVERED" ? " · 판단 불가 구간" : ""}
                    </li>
                  );
                })}
              </ul>

              {finding.surfaceLink ? (
                <Link
                  to={finding.surfaceLink}
                  className="mt-2 inline-block text-sm font-medium text-brand-700 hover:underline"
                >
                  근거 화면 열기
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {objects.length > 0 ? (
        <div className="mt-4">
          {/*
            The objects, under the sentences that named them (Chat-first Agent Shell Completion v1 §8).

            <b>The heading counts; it does not narrate.</b> 「상품 2개」 is what is rendered below it,
            the same arithmetic rule the home briefing follows — and the findings above already said
            what is wrong, so this does not say it again (§11).
          */}
          <h4 className="text-sm font-semibold text-ink">
            이 답변이 가리키는 상품 {objects.length}개
          </h4>
          <ul className="mt-2 space-y-2">
            {objects.map((object) => (
              <li
                key={object.productId}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded border border-line bg-canvas px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="break-keep font-medium text-ink">
                    {/* An id with a link is still openable; 「-」 is not. */}
                    {object.productName ?? "이름을 확인하지 못한 상품"}
                  </p>
                  {object.facts.length > 0 ? (
                    <p className="mt-0.5 break-keep text-xs text-muted">{object.facts.join(" · ")}</p>
                  ) : null}
                </div>
                <Link
                  to={answerObjectHref(object)}
                  className="shrink-0 rounded-full border border-line px-3 py-1 text-sm font-medium text-ink hover:bg-surface"
                >
                  확인하기
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {uncertain.length > 0 ? (
        <div className="mt-4 rounded border border-warn/40 bg-warn/5 p-3">
          <p className="text-sm font-medium text-ink">일부 데이터는 판단할 수 없습니다.</p>
          <ul className="mt-1 space-y-0.5">
            {uncertain.map((c) => (
              <li key={c.signal} className="text-xs text-muted">
                {c.signal}: 연결되지 않은 자료 {c.unlinked}건. 비어 있는 것이 문제가 없다는 뜻은 아닙니다.
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {missingKnowledge.length > 0 ? (
        <div className="mt-4 rounded border border-line bg-canvas p-3">
          {/*
            The AVAILABILITY axis, rendered separately from the attribution one above. They answer
            different questions and have different remedies — "채널을 연결하세요" vs "상품 정보를
            가져오세요" — so a merged notice would leave a seller unable to act on either.
          */}
          <p className="text-sm font-medium text-ink">아직 갖고 있지 않은 상품 정보가 있습니다.</p>
          <ul className="mt-1 space-y-0.5">
            {missingKnowledge.map((c) => (
              <li key={c.facet} className="text-xs text-muted">
                {FACET_LABEL[c.facet] ?? c.facet}:{" "}
                {c.coverage === "STALE"
                  ? `마지막으로 확인한 지 오래됐습니다${c.newestObservedAt ? ` (${c.newestObservedAt.slice(0, 10)})` : ""}.`
                  : "reviewnary가 이 정보를 갖고 있지 않습니다. 상품에 그 값이 없다는 뜻은 아닙니다."}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {answer.nextActions.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {answer.nextActions.map((action) => (
            <Link
              key={action.surfaceLink}
              to={action.surfaceLink}
              className="rounded-full border border-line px-3 py-1 text-sm text-ink hover:bg-surface"
            >
              {action.label}
            </Link>
          ))}
        </div>
      ) : null}

      {/* Printed whenever present. A run that stopped early must never look like one that finished. */}
      {answer.note && (answer.findings.length > 0 || answer.clarification) ? (
        <p className="mt-3 text-xs text-muted">{answer.note}</p>
      ) : null}

      {/* Provenance for the full page only; the panel never shows a model or planner id (design §9). */}
      {compact ? null : <p className="mt-3 text-[11px] text-muted">계획: {answer.plannerVersion}</p>}
    </section>
  );
}

/** Korean labels for the knowledge facets. A raw enum on screen is a leak of a storage detail. */
const FACET_LABEL: Record<string, string> = {
  IDENTITY: "상품 식별",
  LISTING: "채널 등록 정보",
  PRICE: "가격",
  VARIANT: "옵션",
  TAXONOMY: "브랜드·카테고리",
  DESCRIPTION: "상품 설명",
  SPEC: "규격·스펙",
};

/**
 * What the agent decided it had to find out, and whether it did.
 *
 * <b>This is the part a seller can actually audit.</b> A findings list says what came back; this says
 * what was LOOKED FOR — so an answer that quietly covered two of three questions is visible as such
 * rather than reading as a complete reply. A required need left unanswered is called out in words, not
 * only by an icon, because the whole point is that it be readable.
 */
function InvestigationPlanList({ needs }: { needs: OperatorAnswer["needs"] }) {
  return (
    <details className="mt-3 rounded border border-line bg-canvas p-3">
      <summary className="cursor-pointer text-sm font-medium text-ink">
        확인한 항목 {needs.filter((n) => n.status === "SATISFIED").length}/{needs.length}
      </summary>
      <ul className="mt-2 space-y-1">
        {needs.map((need) => (
          <li key={need.id} className="flex items-start gap-2 text-xs">
            <span
              className={
                need.status === "SATISFIED"
                  ? "shrink-0 rounded-full bg-good/10 px-2 py-0.5 font-medium text-good"
                  : need.status === "UNSATISFIABLE"
                    ? "shrink-0 rounded-full bg-warn/10 px-2 py-0.5 font-medium text-warn"
                    : "shrink-0 rounded-full bg-surface px-2 py-0.5 font-medium text-muted"
              }
            >
              {need.status === "SATISFIED" ? "확인" : need.status === "UNSATISFIABLE" ? "불가" : "미확인"}
            </span>
            <span className="break-keep text-muted">
              {need.question}
              {need.reason ? ` — ${need.reason}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
