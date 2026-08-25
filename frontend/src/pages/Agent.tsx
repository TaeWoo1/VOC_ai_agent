import { useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { readAgentContext } from "../lib/agentContext";
import { Link } from "react-router-dom";
import { ProactiveCases } from "../components/proactive/ProactiveCases";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";
import { useApiData } from "../lib/useApiData";
import { useAuth } from "../lib/auth";
import { api } from "../lib/apiClient";
import { productAccounts } from "../lib/productAccounts";
import { agentRuntime, AgentRuntimeError } from "../lib/agentRuntime/agentClient";
import type {
  AgentRunView,
  OperatorAnswer,
  DraftProvenance,
  InquiryCheckpointView,
  InquiryDraftPreparationView,
  InquiryOutcome,
  IssueBriefEntry,
  IssueOperationsBrief,
  ReviewCheckpointView,
  ReviewOutcome,
} from "../lib/agentRuntime/types";

/**
 * 운영 에이전트 — the command surface for the Agent Runtime.
 *
 * The seller types a goal in plain language; the runtime routes it (미답변 문의 / 리뷰 답변 /
 * 운영 이슈) and runs it up to a human checkpoint (inquiry & review) or straight to a structured
 * brief (issue). This page shows the run phase/tool trail and the checkpoint approve/reject
 * controls, and renders the issue brief — but it NEVER shows raw customer 원문. The customer's
 * original inquiry/review text is read only on the existing authorized detail screens (문의 응답 /
 * 리뷰 / 상품 이슈), which this page links to. It also does not re-implement any domain
 * endpoint: every action goes through the Agent Runtime, which calls the backend.
 */
/**
 * What actually wrote this draft, in the seller's words.
 *
 * **Read from the run's own provenance, never hardcoded.** These lines used to say "규칙 기반" because
 * that was the only drafter that existed; with a model behind the seam the same sentence would be a
 * claim about a specific run that can be false in either direction — calling an AI draft rule-based,
 * or (worse, and the failure this product has been careful to avoid) calling a template "AI".
 *
 * A missing provenance is the rule drafter: that is what the runtime falls back to whenever the model
 * capability is off or declines, so the honest default is the conservative one.
 */
function draftKindLabel(provenance: DraftProvenance | null | undefined): string {
  return provenance?.providerKind === "LLM" ? "AI 생성" : "규칙 기반";
}

export function Agent() {
  const { user } = useAuth();
  const caps = useApiData(() => agentRuntime.capabilities(), []);
  // **Product channels only.** This picker used to render `getSellerAccountsStrict()` raw, so it listed
  // `G마켓/옥션 · ESM 문의 엑셀 가져오기` — a channel the product deliberately does not show (2026-08-17: ESM /
  // 11번가 / SSG stay in the catalog and the connector layer, and are "not returned to product surfaces"). An
  // account picker IS a product surface, and offering an account no runtime here can act on is offering work
  // that cannot be done. Both reads degrade to `[]`, which `productAccounts` turns into an empty picker.
  const accounts = useApiData(() => api.getSellerAccountsStrict().catch(() => []), []);
  const channels = useApiData(() => api.getChannelsStrict().catch(() => []), []);
  const selectableAccounts = useMemo(
    () => productAccounts(accounts.data, channels.data),
    [accounts.data, channels.data],
  );

  /**
   * The screen the seller came from, as structured context.
   *
   * <b>A suggested SENTENCE, never an injected fact.</b> The link carries where they were and, at
   * most, a question worth asking — no counts, no names, nothing the planner could then state without
   * a tool call behind it. The evidence contract is unchanged: a run that says "미답변 69건" still had
   * to read it.
   *
   * <b>And it does not send.</b> The sentence lands in the box; the seller presses the button. That is
   * the same rule the Action Window follows one layer up.
   */
  const launchContext = readAgentContext(useLocation().search);
  const [command, setCommand] = useState(launchContext.goal ?? "");
  const [accountId, setAccountId] = useState("");
  const [run, setRun] = useState<AgentRunView | null>(null);
  /**
   * Whether free-text planning is known to be unavailable for THIS org.
   *
   * Learned from a run rather than from `/capabilities`, because that route is public and the planner
   * capability is per-org: a service-level "enabled" would tell one seller that a capability their org
   * does not have is available. Once a run has failed for that reason the input is disabled, so the
   * seller is not invited to type a second sentence that is guaranteed to fail the same way.
   */
  const plannerUnavailable = run?.status === "FAILED" && run.failureCode === "PLANNER_CAPABILITY_OFF";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Advisory label only — the backend re-derives the authoritative approver from the JWT principal,
  // so this is never the security identity. The fallback is unreachable behind the auth-gated route.
  const approvedBy = useMemo(() => (user ? `SELLER:${user.id}` : "SELLER:operator"), [user]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!command.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const view = await agentRuntime.startRun({
        goalText: command.trim(),
        ...(accountId ? { accountId } : {}),
      });
      setRun(view);
    } catch (err) {
      setRun(null);
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Prepare a rule-based answer draft for the top-priority unanswered inquiry (Cafe24 등). The run
   * reads and drafts only — it never proposes, saves, or sends — and finishes at a terminal human
   * checkpoint where the draft is shown. Each call mints a fresh run, so "초안 다시 만들기" reuses this.
   */
  /**
   * Run a Dashboard-lane capability by INTENT.
   *
   * It never goes through the planner, so it keeps working when the planning capability is off — which
   * is the whole reason the two lanes are separate.
   */
  async function runIntent(intent: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const view = await agentRuntime.startRun({
        intent,
        ...(accountId ? { accountId } : {}),
      });
      setRun(view);
    } catch (err) {
      setRun(null);
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  }

  async function prepareDraft() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const view = await agentRuntime.startRun({ intent: "PREPARE_INQUIRY_DRAFT" });
      setRun(view);
    } catch (err) {
      setRun(null);
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  }

  async function decide(threadId: string, approved: boolean, editedComments?: string) {
    setBusy(true);
    setError(null);
    try {
      const view = await agentRuntime.resumeRun(threadId, {
        approved,
        approvedBy,
        ...(editedComments !== undefined ? { editedComments } : {}),
      });
      setRun(view);
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="운영 에이전트"
        description="한 줄로 운영 작업을 지시하면 에이전트가 문의·리뷰·이슈를 분류해 사람이 확인할 지점까지 준비합니다."
        meta={caps.data ? <CapabilityMeta /> : undefined}
      />

      {/* Before the prompt, not after it. The Agent screen used to answer only what it was asked;
          work SellerOps has already investigated should not need to be asked for. */}
      <ProactiveCases limit={4} heading="이미 확인해 둔 일" />

      <Section title="무엇을 확인해볼까요?">
        <form onSubmit={submit} className="space-y-3" aria-label="에이전트 명령 입력">
          {/* The heading above already asks the question; a second 「명령」 label under it was the
              same field named twice, in the harsher of the two words. */}
          <label htmlFor="agent-command" className="sr-only">
            확인할 내용
          </label>
          <textarea
            id="agent-command"
            className="w-full rounded-xl border border-line bg-canvas p-3 text-ink"
            rows={2}
            placeholder="예: 오늘 뭐부터 봐야 해?"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            disabled={plannerUnavailable}
            aria-describedby={plannerUnavailable ? "agent-planner-off" : undefined}
          />
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="agent-account" className="block text-sm font-medium text-ink">
                판매 계정 <span className="text-muted">(리뷰 답변에 필요)</span>
              </label>
              <select
                id="agent-account"
                className="mt-1 rounded-xl border border-line bg-canvas p-2 text-ink"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                <option value="">선택 안 함</option>
                {selectableAccounts.map(({ account, label }) => (
                  <option key={account.id} value={account.id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="btn-primary"
              disabled={busy || !command.trim() || plannerUnavailable}
            >
              {busy ? "실행 중…" : "실행"}
            </button>
          </div>
          {caps.data ? (
            <ExampleChips onPick={setCommand} onRunIntent={runIntent} busy={busy} />
          ) : null}
          {plannerUnavailable ? (
            /*
              Not an error banner: a capability being off is a configuration state, not a failure of the
              request. It stays visible after the failed run so the seller is not left re-typing the same
              sentence — and it says what still works, because the rest of the product does.
            */
            <div id="agent-planner-off" className="rounded-xl border border-warn/40 bg-warn/5 p-3" role="status">
              {/*
                Says why the INPUT is disabled, and stops there. The run card below carries the run's own
                reason; repeating that sentence here would print one fact twice and make the shorter,
                more actionable line harder to find.
              */}
              <p className="text-sm text-muted">
                지금은 문장으로 요청할 수 없습니다. 아래 바로가기를 사용해 주세요.
              </p>
            </div>
          ) : null}
        </form>
      </Section>

      <Section title="문의 답변 초안">
        <p className="text-sm text-muted">
          미답변 문의를 하나 골라 답변 <b>초안</b>을 만들어 보여드립니다. 무엇이 초안을 썼는지는 결과 카드의
          &quot;생성 방식&quot;에 그대로 표시됩니다. 초안은 검토·편집용이며, SellerOps가 채널로 대신 전송하지
          않습니다 <span className="text-good">(외부 발송 없음)</span>.
        </p>
        <button type="button" className="btn-primary mt-3" disabled={busy} onClick={prepareDraft}>
          {busy ? "생성 중…" : "초안 생성"}
        </button>
      </Section>

      {error ? (
        <div role="alert" className="card border-bad/40 text-bad">
          <p className="font-medium">요청을 처리하지 못했습니다.</p>
          <p className="mt-1 text-sm text-muted">{error}</p>
        </div>
      ) : null}

      {/* key on threadId: a new run must remount RunView so the inquiry draft editor re-seeds
          from the new checkpoint and a stale edit can never be recorded against another thread. */}
      {run ? (
        <RunView key={run.threadId} run={run} busy={busy} onDecide={decide} onRegenerate={prepareDraft} />
      ) : null}
    </div>
  );
}

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
function OperatorAnswerCard({ answer }: { answer: OperatorAnswer }) {
  const evidenceById = new Map(answer.evidence.map((e) => [e.evidenceId, e]));
  const uncertain = answer.coverage.filter((c) => c.coverage !== "COVERED");
  // SIGNALS is the attribution axis and is already covered by `uncertain` above; repeating it here
  // would print the same limitation twice under two different headings.
  const missingKnowledge = (answer.knowledgeCoverage ?? []).filter(
    (c) => c.facet !== "SIGNALS" && (c.coverage === "UNAVAILABLE" || c.coverage === "STALE"),
  );

  return (
    <section className="mt-4 rounded-lg border border-line bg-surface p-4">
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
        <div className="mt-3 rounded border border-accent/40 bg-accent/5 p-3">
          <p className="break-keep leading-relaxed text-ink">{answer.clarification}</p>
        </div>
      ) : null}

      {answer.needs.length > 0 ? <InvestigationPlanList needs={answer.needs} /> : null}

      {answer.findings.length === 0 && !answer.clarification ? (
        <p className="mt-3 text-muted">{answer.note ?? "말씀드릴 만한 것을 찾지 못했습니다."}</p>
      ) : answer.findings.length === 0 ? null : (
        <ul className="mt-3 space-y-3">
          {answer.findings.map((finding) => (
            <li key={finding.findingId} className="rounded border border-line bg-bg p-3">
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
                    <li key={id} className="text-xs text-muted">
                      근거 {ref.evidenceId} · {ref.locator.label ?? ref.kind}
                      {ref.locator.count != null ? ` ${ref.locator.count}건` : ""}
                      {ref.events ? ` · ${ref.events.from ?? "?"}~${ref.events.to ?? "?"} 발생` : ""}
                      {ref.asOf ? ` · ${ref.asOf} 확인` : ""}
                      {ref.coverage !== "COVERED" ? " · 판단 불가 구간" : ""}
                      {" · "}
                      {ref.provenance}
                    </li>
                  );
                })}
              </ul>

              {finding.surfaceLink ? (
                <Link
                  to={finding.surfaceLink}
                  className="mt-2 inline-block text-sm font-medium text-accent hover:underline"
                >
                  근거 화면 열기
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}

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
        <div className="mt-4 rounded border border-line bg-bg p-3">
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
                  : "SellerOps가 이 정보를 갖고 있지 않습니다. 상품에 그 값이 없다는 뜻은 아닙니다."}
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

      <p className="mt-3 text-[11px] text-muted">계획: {answer.plannerVersion}</p>
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
    <details className="mt-3 rounded border border-line bg-bg p-3">
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

/**
 * The one thing a seller needs to know before typing: nothing here reaches a customer.
 *
 * <b>What was removed (Demo UX Polish v1).</b> The run store used to be announced beside it —
 * 「저장: 재시작 복원 · 단일 인스턴스」 — which is a deployment fact about a Node process, in the
 * header of a screen a seller opens to ask about their inquiries. It never changed a decision they
 * could make. The safety line stays, without its engineering parenthetical: 「fail-closed」 is the
 * name of the mechanism, not the promise, and the promise is the part the seller is owed.
 */
function CapabilityMeta() {
  return (
    <span className="rounded-full bg-good/10 px-2 py-0.5 text-xs font-medium text-good">
      고객에게 대신 보내지 않습니다
    </span>
  );
}

/**
 * Starting points — and the two LANES made visible.
 *
 * <b>The first two fill the box; the last two run a capability directly.</b> That is not cosmetic. Until
 * Operator Graph v2, "미답변 문의 처리해줘" was a SENTENCE that a keyword table happened to route to the
 * approve loop. With the table gone, a sentence goes to the planner — so a chip that still typed those
 * words would silently change what the button does. A Dashboard-lane shortcut names its intent, the way
 * a menu item does.
 *
 * The two free-text chips are illustrations, not a supported list: anything may be typed, and the
 * planner interprets it or the run fails and says so.
 */
function ExampleChips({
  onPick,
  onRunIntent,
  busy,
}: {
  onPick: (c: string) => void;
  onRunIntent: (intent: string) => void;
  busy: boolean;
}) {
  const goals = ["오늘 뭐부터 봐야 해?", "이번 주 대표에게 보고할 내용 정리해줘"];
  const shortcuts: Array<{ label: string; intent: string }> = [
    { label: "미답변 문의 처리", intent: "HANDLE_UNANSWERED_INQUIRIES" },
    { label: "리뷰 답변 준비", intent: "HANDLE_REVIEW_REPLIES" },
  ];
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {goals.map((ex) => (
        <button
          key={ex}
          type="button"
          className="rounded-full border border-line px-3 py-1 text-sm text-muted hover:text-ink"
          onClick={() => onPick(ex)}
        >
          {ex}
        </button>
      ))}
      {shortcuts.map((s) => (
        <button
          key={s.intent}
          type="button"
          disabled={busy}
          className="rounded-full border border-accent/40 bg-accent/5 px-3 py-1 text-sm text-ink hover:bg-accent/10"
          onClick={() => onRunIntent(s.intent)}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

const DOMAIN_LABEL: Record<string, string> = {
  OPERATOR: "운영 판단",
  INQUIRY: "문의 응답",
  INQUIRY_DRAFT: "문의 답변 초안",
  REVIEW: "리뷰 답변",
  ISSUE: "운영 이슈",
};

function RunView({
  run,
  busy,
  onDecide,
  onRegenerate,
}: {
  run: AgentRunView;
  busy: boolean;
  onDecide: (threadId: string, approved: boolean, editedComments?: string) => void;
  onRegenerate: () => void;
}) {
  const statusLabel =
    run.status === "AWAITING_APPROVAL"
      ? "확인 필요"
      : run.status === "FAILED"
        ? "처리하지 못함"
        : run.domain === "INQUIRY_DRAFT"
          ? "초안 준비됨"
          : "완료";
  return (
    <section className="card space-y-4" aria-label="에이전트 실행" role="region">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-brand/10 px-2 py-0.5 text-sm font-medium text-brand">
          {DOMAIN_LABEL[run.domain] ?? run.domain}
        </span>
        <span className="text-sm text-muted">{statusLabel}</span>
      </div>

      <RunTrail trail={run.trail} />

      {run.status === "FAILED" ? (
        /*
          A run that could not be planned. Rendered as its own state rather than as an empty answer,
          because an empty answer says "확인했고 아무것도 없었다" — a different and false claim. The
          reason comes from the run; this component does not compose one.
        */
        <div role="status" className="rounded-xl border border-warn/40 bg-warn/5 p-3">
          <p className="break-keep leading-relaxed text-ink">
            {run.failureReason ?? "요청을 처리하지 못했습니다."}
          </p>
        </div>
      ) : null}

      {run.status === "AWAITING_APPROVAL" && run.checkpoint?.kind === "INQUIRY_REPLY_APPROVAL" ? (
        <InquiryCheckpointCard
          threadId={run.threadId}
          checkpoint={run.checkpoint}
          busy={busy}
          onDecide={onDecide}
        />
      ) : null}

      {run.status === "AWAITING_APPROVAL" && run.checkpoint?.kind === "REVIEW_REPLY_APPROVAL" ? (
        <ReviewCheckpointCard
          threadId={run.threadId}
          checkpoint={run.checkpoint}
          busy={busy}
          onDecide={onDecide}
        />
      ) : null}

      {run.status === "DONE" && run.domain === "INQUIRY_DRAFT" && run.draftPreparation ? (
        <InquiryDraftPreparationCard prep={run.draftPreparation} busy={busy} onRegenerate={onRegenerate} />
      ) : null}

      {run.status === "DONE" && run.domain === "ISSUE" && run.brief ? <IssueBriefCard brief={run.brief} /> : null}

      {run.status === "DONE" && run.domain === "OPERATOR" && run.answer ? (
        <OperatorAnswerCard answer={run.answer} />
      ) : null}

      {run.status === "DONE" && run.domain !== "ISSUE" && run.domain !== "INQUIRY_DRAFT" ? (
        <OutcomeCard domain={run.domain} outcome={run.outcome ?? null} />
      ) : null}
    </section>
  );
}

function RunTrail({ trail }: { trail: string[] }) {
  if (!trail.length) return null;
  return (
    <ol className="flex flex-wrap items-center gap-1 text-xs text-muted" aria-label="실행 단계">
      {trail.map((step, i) => (
        <li key={`${step}-${i}`} className="flex items-center gap-1">
          <span className="rounded bg-surface px-2 py-0.5">{step}</span>
          {i < trail.length - 1 ? <span aria-hidden>→</span> : null}
        </li>
      ))}
    </ol>
  );
}

function InquiryCheckpointCard({
  threadId,
  checkpoint,
  busy,
  onDecide,
}: {
  threadId: string;
  checkpoint: InquiryCheckpointView;
  busy: boolean;
  onDecide: (threadId: string, approved: boolean, editedComments?: string) => void;
}) {
  const [reply, setReply] = useState(checkpoint.replyDraft ?? "");
  return (
    <div className="rounded-2xl border border-line bg-surface p-4" role="group" aria-label="문의 답변 승인">
      <p className="text-sm text-muted">
        {draftKindLabel(checkpoint.provenance)} 초안입니다. 고객 원문은
        <Link to="/inquiries" className="mx-1 text-brand underline">
          문의 응답
        </Link>
        화면에서 확인하세요.
      </p>
      {checkpoint.replyDraft !== undefined ? (
        <textarea
          className="mt-3 w-full rounded-xl border border-line bg-canvas p-3 text-ink"
          rows={4}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          aria-label="답변 초안"
        />
      ) : (
        <p className="mt-3 text-sm text-muted">
          초안 본문은 새로고침 후에는 다시 표시되지 않습니다. 명령을 다시 실행하면 초안을 볼 수 있습니다.
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          className="btn-primary"
          disabled={busy || checkpoint.replyDraft === undefined}
          // **Always the text on screen, not only when it was edited.**
          //
          // The runtime cannot replay a draft it never stored (`RunSnapshot` holds no draft text, by
          // contract), so on resume it re-derives one. Sending nothing meant "record whatever the
          // re-derivation produces" — invisible while the only drafter was a template table, and a
          // silent integrity failure the moment a model is behind the seam: the recorded reply would
          // not be the one this person read and approved. Sending it makes the approval bind to the
          // text, which is what an approval is for.
          onClick={() => onDecide(threadId, true, reply)}
        >
          승인 (기록)
        </button>
        <button className="btn-ghost" disabled={busy} onClick={() => onDecide(threadId, false)}>
          거절
        </button>
      </div>
    </div>
  );
}

/**
 * The draft-preparation result — a generated answer draft the operator reviews, edits locally, and
 * copies to post on the channel themselves. There is deliberately NO approve/reject and NO
 * send/전송 control: the run already finished at the human checkpoint and nothing is dispatched.
 * "초안 다시 만들기" starts a fresh run; if the operator edited the draft, it first warns that the
 * edit will be overwritten.
 */
function InquiryDraftPreparationCard({
  prep,
  busy,
  onRegenerate,
}: {
  prep: InquiryDraftPreparationView;
  busy: boolean;
  onRegenerate: () => void;
}) {
  const [reply, setReply] = useState(prep.replyDraft ?? "");
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!prep.prepared) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-4" role="group" aria-label="문의 답변 초안">
        <p className="text-ink">지금 초안을 만들 미답변 문의가 없습니다.</p>
        <button type="button" className="btn-ghost mt-3" disabled={busy} onClick={onRegenerate}>
          다시 확인
        </button>
      </div>
    );
  }

  const channel = prep.channelNameKo ?? prep.channelCode ?? "채널";
  const edited = reply !== (prep.replyDraft ?? "");
  const statusLabel = prep.inquiryStatus === "ANSWERED" ? "답변완료" : "미답변";
  const provenanceText = prep.provenance
    ? `${draftKindLabel(prep.provenance)} · ${prep.provenance.name} ${prep.provenance.version}`
    : "규칙 기반";
  const generatedLabel = prep.generatedAt ? new Date(prep.generatedAt).toLocaleString("ko-KR") : "—";

  function regenerate() {
    // Warn once before discarding a locally edited draft; a pristine draft regenerates directly.
    if (edited && !confirmRegen) {
      setConfirmRegen(true);
      return;
    }
    setConfirmRegen(false);
    onRegenerate();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(reply);
      setCopied(true);
    } catch {
      // clipboard unavailable — the operator can still select the text manually
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-4" role="group" aria-label="문의 답변 초안">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">답변 초안</span>
        {prep.isSecret === true ? (
          <span className="rounded-full bg-warn/10 px-2 py-0.5 text-xs font-medium text-warn">비밀글</span>
        ) : null}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Meta label="대상 채널" value={channel} />
        <Meta label="문의 상태" value={statusLabel} />
        <Meta label="생성 시각" value={generatedLabel} />
        <Meta label="생성 방식" value={provenanceText} />
      </dl>

      <p className="mt-3 text-sm text-muted">
        {draftKindLabel(prep.provenance)} 초안입니다. 고객 원문은
        <Link to="/inquiries" className="mx-1 text-brand underline">
          문의 응답
        </Link>
        화면에서 확인하세요.
      </p>
      <textarea
        className="mt-3 w-full rounded-xl border border-line bg-canvas p-3 text-ink"
        rows={4}
        value={reply}
        onChange={(e) => {
          setReply(e.target.value);
          setCopied(false);
        }}
        aria-label="답변 초안"
      />

      <p className="mt-2 text-sm font-medium text-good">
        초안만 생성되었습니다. {channel}에는 아직 전송되지 않았습니다.
      </p>
      <p className="mt-1 text-xs text-muted">
        SellerOps가 대신 전송하지 않습니다. 검토 후 채널에 직접 붙여넣어 답변하세요.
      </p>

      {confirmRegen ? (
        <div role="alert" className="mt-3 rounded-xl border border-warn/40 bg-warn/5 p-3 text-sm">
          <p className="text-ink">다시 만들면 편집한 초안이 사라집니다. 계속할까요?</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn-primary" disabled={busy} onClick={regenerate}>
              계속
            </button>
            <button type="button" className="btn-ghost" onClick={() => setConfirmRegen(false)}>
              취소
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-ghost" disabled={busy} onClick={regenerate}>
            초안 다시 만들기
          </button>
          <button type="button" className="btn-ghost" onClick={copy}>
            복사
          </button>
        </div>
      )}
      {copied ? <p className="mt-2 text-sm text-good">복사했습니다. {channel}에 직접 붙여넣으세요.</p> : null}
    </div>
  );
}

function ReviewCheckpointCard({
  threadId,
  checkpoint,
  busy,
  onDecide,
}: {
  threadId: string;
  checkpoint: ReviewCheckpointView;
  busy: boolean;
  onDecide: (threadId: string, approved: boolean, editedComments?: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4" role="group" aria-label="리뷰 답변 승인">
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Meta label="상품" value={checkpoint.productName ?? "—"} />
        <Meta label="평점" value={checkpoint.rating != null ? `${checkpoint.rating}점` : "—"} />
        <Meta label="작성일" value={checkpoint.reviewDate ?? "—"} />
        <Meta label="초안 버전" value={`v${checkpoint.draftVersion}`} />
      </dl>
      <p className="mt-3 text-sm text-muted">
        리뷰 원문과 답변 초안은
        <Link to="/reviews" className="mx-1 text-brand underline">
          리뷰
        </Link>
        화면에서 확인·수정하세요. 여기서는 저장된 버전(v{checkpoint.draftVersion})을 승인/거절만 합니다.
      </p>
      <div className="mt-3 flex gap-2">
        <button className="btn-primary" disabled={busy} onClick={() => onDecide(threadId, true)}>
          승인 (기록)
        </button>
        <button className="btn-ghost" disabled={busy} onClick={() => onDecide(threadId, false)}>
          거절
        </button>
      </div>
    </div>
  );
}

function OutcomeCard({ domain, outcome }: { domain: string; outcome: InquiryOutcome | ReviewOutcome | null }) {
  const decision = outcome?.decision ?? "NONE";
  // For a REVIEW run with nothing to prepare, "처리할 항목 없음" would read as "nothing to do" even
  // when replies are prepared/approved and only awaiting the human post — so say it precisely and
  // point to where that post happens.
  const label =
    decision === "APPROVED"
      ? "승인 기록됨"
      : decision === "REJECTED"
        ? "거절 기록됨"
        : domain === "REVIEW"
          ? "새로 준비할 리뷰가 없습니다"
          : "처리할 항목 없음";
  return (
    <div className="rounded-2xl border border-line bg-surface p-4" role="group" aria-label="실행 결과">
      <p className="font-medium text-ink">{label}</p>
      <p className="mt-1 text-sm text-good">외부로 발송된 내용은 없습니다 (외부 발송 없음).</p>
      {domain === "REVIEW" && decision === "NONE" ? (
        <p className="mt-1 text-sm text-muted">
          준비·승인된 답변은
          <Link to="/reviews" className="mx-1 text-brand underline">
            리뷰
          </Link>
          에서 등록합니다.
        </p>
      ) : null}
      {domain === "REVIEW" && outcome && "guidedSessionPrepared" in outcome && outcome.guidedSessionPrepared ? (
        <p className="mt-1 text-sm text-muted">
          안내형 등록 준비가 완료되었습니다.
          <Link to="/reviews" className="mx-1 text-brand underline">
            리뷰
          </Link>
          에서 사람이 직접 등록합니다.
        </p>
      ) : null}
    </div>
  );
}

function IssueBriefCard({ brief }: { brief: IssueOperationsBrief }) {
  if (brief.selectedCount === 0) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-4" role="group" aria-label="운영 이슈 브리핑">
        <p className="text-ink">{brief.note ?? "지금 확인할 운영 이슈가 없습니다."}</p>
      </div>
    );
  }
  return (
    <div className="space-y-3" role="group" aria-label="운영 이슈 브리핑">
      <p className="text-sm text-muted">
        활성 이슈 {brief.totalActiveIssues}건 중 우선순위 {brief.selectedCount}건입니다.
      </p>
      <ol className="space-y-3">
        {brief.entries.map((e) => (
          <IssueEntry key={e.issueId} entry={e} />
        ))}
      </ol>
      <p className="text-sm text-muted">
        자세한 근거는
        <Link to="/issues" className="mx-1 text-brand underline">
          상품 이슈
        </Link>
        화면에서 확인하세요.
      </p>
    </div>
  );
}

const SEVERITY_LABEL: Record<string, string> = { HIGH: "높음", NORMAL: "보통", LOW: "낮음" };

function IssueEntry({ entry }: { entry: IssueBriefEntry }) {
  return (
    <li className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">#{entry.rank}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            entry.severity === "HIGH" ? "bg-bad/10 text-bad" : entry.severity === "LOW" ? "bg-surface text-muted" : "bg-warn/10 text-warn"
          }`}
        >
          {SEVERITY_LABEL[entry.severity] ?? entry.severity}
        </span>
        <span className="font-medium text-ink">{entry.title}</span>
      </div>
      <p className="mt-1 text-sm text-muted">
        {entry.aspect} · {entry.problem} · 근거 {entry.evidenceCount}건
        {entry.dominantProductName ? ` · 주로 ${entry.dominantProductName}` : ""}
      </p>
      {entry.trend.labelsKo.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {entry.trend.labelsKo.map((l) => (
            <span key={l} className="rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand">
              {l}
            </span>
          ))}
        </div>
      ) : null}
    </li>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}

/** Coarse, content-free explanation for an agent-runtime failure. */
function explain(err: unknown): string {
  if (err instanceof AgentRuntimeError) {
    switch (err.code) {
      case "MISSING_ACCOUNT_SCOPE":
        return "리뷰 답변은 판매 계정을 선택해야 합니다.";
      case "UNRECOGNIZED_GOAL":
        return "지원하는 작업을 찾지 못했습니다. 문의·리뷰·이슈 중 하나로 다시 말해 주세요.";
      case "EXECUTION_ENABLED":
        return "안전 점검 실패: 외부 발송 경로가 활성화되어 실행을 중단했습니다.";
      case "NO_CHECKPOINT":
        return "이 실행에는 확인 단계가 없습니다.";
      case "MISSING_TOKEN":
        return "로그인이 필요합니다.";
      case "RESUME_IN_PROGRESS":
        return "이미 처리 중인 요청입니다. 잠시 후 다시 시도해 주세요.";
      case "RESUME_CONFLICT":
        return "다른 곳에서 먼저 처리되어 순서가 어긋났습니다. 새로고침 후 다시 확인해 주세요.";
      case "HTTP_409":
        return "이미 처리되었거나 다른 곳에서 변경된 항목입니다. 새로고침 후 다시 확인해 주세요.";
      default:
        return `요청이 거부되었습니다 (${err.status}).`;
    }
  }
  return "에이전트 서비스에 연결하지 못했습니다.";
}
