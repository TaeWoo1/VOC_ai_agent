import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { readAgentContext } from "../lib/agentContext";
import { Link } from "react-router-dom";
import { ProactiveCases } from "../components/proactive/ProactiveCases";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";
import { Disclosure } from "../components/ui/Disclosure";
import { Btn, BtnLink } from "../components/ui/Btn";
import { useApiData } from "../lib/useApiData";
import { useAuth } from "../lib/auth";
import { api } from "../lib/apiClient";
import { productAccounts } from "../lib/productAccounts";
import { agentRuntime } from "../lib/agentRuntime/agentClient";
import { OperatorAnswerView } from "../components/agent/OperatorAnswerView";
import { explainAgentError as explain } from "../lib/agentRuntime/explain";
import type {
  AgentRunView,
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

  /**
   * The runtime itself did not answer.
   *
   * <b>Known at mount, and it used to be discarded.</b> `/capabilities` is the first thing this page
   * asks for, so a runtime that is not running is a fact this screen holds before the seller types a
   * word — and the screen then let them type it, press, wait, and read a failure. A box that cannot
   * work must say so while it is still empty.
   *
   * <b>It is not a channel problem, and it must not read as one.</b> A seller whose 카페24 connection
   * is healthy would otherwise learn, from this screen, that something about their shop broke. The
   * rest of the product — 문의, 리뷰, 주문, and the home 물어보기 shortcuts — is untouched by this and
   * the copy says so.
   */
  const runtimeUnavailable = caps.error && !caps.loading;
  const askDisabled = plannerUnavailable || runtimeUnavailable;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Seconds this request has been in flight.
   *
   * <b>Elapsed time, not progress</b> (Disconnected Channel Onboarding Live Walkthrough v1 §12). The
   * planner call is one blocking HTTP request — the trail arrives WITH the answer — so this screen
   * holds no intermediate state to draw, and a bar or a stage list would be an animation of something
   * nobody measured. A live clock is a fact, and it is the fact that separates 「생각하는 중」 from
   * 「멈춘 것 같다」 during a 22-second wait (measured, 2026-08-27).
   */
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!busy) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

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
        // The screen the seller came from, carried into the run (Chat-first Agent Shell Completion
        // v1 §9). Until this package the id reached the URL and died here, so 「이 상품만 봐줘」 from
        // a product page had to name the product again in the sentence — and did, which is why the
        // gap was invisible. The id is a hint the runtime verifies, never an injected fact.
        ...(launchContext.productId ? { productId: launchContext.productId } : {}),
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
      {/* One sentence, and it is about what the seller gets — not about how the run is structured.
          「한 줄로 운영 작업을 지시하면 에이전트가 문의·리뷰·이슈를 분류해 사람이 확인할 지점까지
          준비합니다」 is a description of an execution graph (Executive-friendly UX Redesign v1). */}
      <PageHeader
        title="운영 에이전트"
        description="물어보면 대신 확인하고 정리해 드립니다."
        meta={caps.data ? <CapabilityMeta /> : undefined}
      />

      {/* Before the prompt, not after it. The Agent screen used to answer only what it was asked;
          work SellerOps has already investigated should not need to be asked for. */}
      {/* The same cards under the same name as everywhere else (Executive Readiness Fix v1). Calling
          them 「이미 확인해 둔 일」 here and 「AI가 먼저 확인한 일」 on 홈 made one thing look like two. */}
      <ProactiveCases limit={4} />

      <Section title="무엇을 확인해볼까요?">
        <form onSubmit={submit} className="space-y-3" aria-label="에이전트 명령 입력">
          {runtimeUnavailable ? (
            /*
              ABOVE the box it disables. It shipped below the input and the account picker, so the
              seller met a dead control first and the reason for it third.

              And it does NOT say 「채널 연결에는 문제가 없습니다」. On an org with nothing connected
              that sentence is false, and this notice is not entitled to an opinion about the
              seller's channels — only about the fact that this failure is not one of them.
            */
            <div id="agent-runtime-off" className="rounded-xl border border-warn/40 bg-warn/5 p-3" role="status">
              <p className="text-base font-semibold text-ink">AI 도우미를 시작하지 못했습니다.</p>
              <p className="mt-1 break-keep text-sm text-muted">
                채널 연결과는 관계없는 문제입니다. 문의·리뷰·주문 화면은 그대로 사용할 수 있고, 홈의
                「무엇을 도와드릴까요?」에서 미답변 문의와 리뷰 문제도 계속 확인할 수 있습니다.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <BtnLink to="/" size="sm" variant="outline">
                  홈으로 가기
                </BtnLink>
                <Btn size="sm" variant="ghost" onClick={() => window.location.reload()}>
                  다시 시도
                </Btn>
              </div>
            </div>
          ) : null}
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
            disabled={askDisabled}
            aria-describedby={
              runtimeUnavailable ? "agent-runtime-off" : plannerUnavailable ? "agent-planner-off" : undefined
            }
          />
          {/* Examples sit between the box and the button, where a seller who does not know what to
              type reads them — not under the account picker two controls further down. */}
          {caps.data ? (
            <ExampleChips onPick={setCommand} onRunIntent={runIntent} busy={busy} />
          ) : null}

          {/* The button is alone on its line. The 판매 계정 select used to sit beside it at the same
              weight while mattering to one kind of request out of many, and a labelled dropdown next
              to the only submit control reads as a required field. */}
          <button
            type="submit"
            className="btn-primary"
            disabled={busy || !command.trim() || askDisabled}
          >
            {busy ? "확인 중…" : "물어보기"}
          </button>
          {/* What a seller cannot tell from a spinner: whether anything is still happening. The
              number is measured, and the sentence says the shape of the work without claiming a
              stage this screen has no way to know it reached. */}
          {busy ? (
            <p className="break-keep text-sm text-muted" role="status">
              문의·리뷰·주문을 확인하고 있습니다. 보통 20초쯤 걸립니다 · {elapsed}초 경과
            </p>
          ) : null}
          {/* A collapsed control needs a marker, or it reads as a label with nothing behind it —
              which is exactly how a reader with no explanation read this one (Executive Readiness
              Fix v1): 「고를 것이 화면에 없다」. */}
          <Disclosure label="판매 계정 선택 (리뷰 답변을 준비할 때만 필요)" summaryClassName="px-0">
            <label htmlFor="agent-account" className="sr-only">
              판매 계정
            </label>
            <select
              id="agent-account"
              className="mt-2 rounded-xl border border-line bg-canvas p-2 text-ink"
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
          </Disclosure>
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

      {/*
        FOLDED INTO THE ONE THING THIS SCREEN DOES (Executive-friendly UX Redesign v1).

        This was a second `Section` with its own paragraph and its own `btn-primary`, so the Agent
        screen presented two equally-loud workflows and the seller had to work out which box was the
        one they wanted. Nothing was removed: the same `prepareDraft` runs from a secondary control
        under the prompt, and 문의 — which owns the reply lifecycle — is where a seller goes to answer
        a specific customer.
      */}
      <div className="-mt-2 space-y-1.5">
        <button
          type="button"
          className="btn-ghost text-sm"
          disabled={busy || runtimeUnavailable}
          onClick={prepareDraft}
        >
          {busy ? "준비 중…" : "미답변 문의로 답변 초안 만들어 보기"}
        </button>
        {/* The guarantee travels with the control it qualifies. The paragraph this replaced also
            explained where the generation method is recorded and that the draft is for review —
            both of which the result card itself states, in place, when a draft exists. */}
        <p className="text-sm text-muted">
          초안만 만듭니다 <span className="text-good">(외부 발송 없음)</span>.
        </p>
      </div>

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
        <OperatorAnswerView answer={run.answer} />
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
        reviewnary가 대신 전송하지 않습니다. 검토 후 채널에 직접 붙여넣어 답변하세요.
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

