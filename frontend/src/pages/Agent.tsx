import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";
import { useApiData } from "../lib/useApiData";
import { useAuth } from "../lib/auth";
import { api } from "../lib/apiClient";
import { agentRuntime, AgentRuntimeError } from "../lib/agentRuntime/agentClient";
import type {
  AgentRunView,
  InquiryCheckpointView,
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
 * 리뷰 운영 / 상품 이슈), which this page links to. It also does not re-implement any domain
 * endpoint: every action goes through the Agent Runtime, which calls the backend.
 */
export function Agent() {
  const { user } = useAuth();
  const caps = useApiData(() => agentRuntime.capabilities(), []);
  const accounts = useApiData(() => api.getSellerAccountsStrict().catch(() => []), []);

  const [command, setCommand] = useState("");
  const [accountId, setAccountId] = useState("");
  const [run, setRun] = useState<AgentRunView | null>(null);
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
        meta={caps.data ? <CapabilityMeta store={caps.data.runStore} /> : undefined}
      />

      <Section title="무엇을 도와드릴까요?">
        <form onSubmit={submit} className="space-y-3" aria-label="에이전트 명령 입력">
          <label htmlFor="agent-command" className="block text-sm font-medium text-ink">
            명령
          </label>
          <textarea
            id="agent-command"
            className="w-full rounded-xl border border-line bg-canvas p-3 text-ink"
            rows={2}
            placeholder="예: 미답변 문의 처리해줘 / 리뷰 답변 준비해줘 / 지금 먼저 확인할 운영 이슈는 뭐야"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
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
                {(accounts.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.channelNameKo}
                    {a.alias ? ` · ${a.alias}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn-primary" disabled={busy || !command.trim()}>
              {busy ? "실행 중…" : "실행"}
            </button>
          </div>
          {caps.data ? <ExampleChips onPick={setCommand} /> : null}
        </form>
      </Section>

      {error ? (
        <div role="alert" className="card border-bad/40 text-bad">
          <p className="font-medium">요청을 처리하지 못했습니다.</p>
          <p className="mt-1 text-sm text-muted">{error}</p>
        </div>
      ) : null}

      {/* key on threadId: a new run must remount RunView so the inquiry draft editor re-seeds
          from the new checkpoint and a stale edit can never be recorded against another thread. */}
      {run ? <RunView key={run.threadId} run={run} busy={busy} onDecide={decide} /> : null}
    </div>
  );
}

function CapabilityMeta({ store }: { store: { durable: boolean; multiInstanceSafe: boolean } }) {
  return (
    <>
      <span className="rounded-full bg-good/10 px-2 py-0.5 text-xs font-medium text-good">
        외부 발송 없음 (fail-closed)
      </span>
      <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-muted">
        저장: {store.durable ? "재시작 복원" : "메모리"}
        {store.multiInstanceSafe ? "" : " · 단일 인스턴스"}
      </span>
    </>
  );
}

function ExampleChips({ onPick }: { onPick: (c: string) => void }) {
  const examples = ["미답변 문의 처리해줘", "리뷰 답변 준비해줘", "지금 먼저 확인할 운영 이슈는 뭐야"];
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {examples.map((ex) => (
        <button
          key={ex}
          type="button"
          className="rounded-full border border-line px-3 py-1 text-sm text-muted hover:text-ink"
          onClick={() => onPick(ex)}
        >
          {ex}
        </button>
      ))}
    </div>
  );
}

const DOMAIN_LABEL: Record<string, string> = {
  INQUIRY: "문의 응답",
  REVIEW: "리뷰 답변",
  ISSUE: "운영 이슈",
};

function RunView({
  run,
  busy,
  onDecide,
}: {
  run: AgentRunView;
  busy: boolean;
  onDecide: (threadId: string, approved: boolean, editedComments?: string) => void;
}) {
  return (
    <section className="card space-y-4" aria-label="에이전트 실행" role="region">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-brand/10 px-2 py-0.5 text-sm font-medium text-brand">
          {DOMAIN_LABEL[run.domain] ?? run.domain}
        </span>
        <span className="text-sm text-muted">{run.status === "AWAITING_APPROVAL" ? "확인 필요" : "완료"}</span>
      </div>

      <RunTrail trail={run.trail} />

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

      {run.status === "DONE" && run.domain === "ISSUE" && run.brief ? <IssueBriefCard brief={run.brief} /> : null}

      {run.status === "DONE" && run.domain !== "ISSUE" ? <OutcomeCard domain={run.domain} outcome={run.outcome ?? null} /> : null}
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
        규칙 기반 초안입니다{checkpoint.provenance ? ` (${checkpoint.provenance.providerKind})` : ""}. 고객 원문은
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
          onClick={() => onDecide(threadId, true, reply !== checkpoint.replyDraft ? reply : undefined)}
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
        <Link to="/operations" className="mx-1 text-brand underline">
          리뷰 운영
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
  const label = decision === "APPROVED" ? "승인 기록됨" : decision === "REJECTED" ? "거절 기록됨" : "처리할 항목 없음";
  return (
    <div className="rounded-2xl border border-line bg-surface p-4" role="group" aria-label="실행 결과">
      <p className="font-medium text-ink">{label}</p>
      <p className="mt-1 text-sm text-good">외부로 발송된 내용은 없습니다 (외부 발송 없음).</p>
      {domain === "REVIEW" && outcome && "guidedSessionPrepared" in outcome && outcome.guidedSessionPrepared ? (
        <p className="mt-1 text-sm text-muted">
          안내형 등록 준비가 완료되었습니다.
          <Link to="/operations" className="mx-1 text-brand underline">
            리뷰 운영
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
      default:
        return `요청이 거부되었습니다 (${err.status}).`;
    }
  }
  return "에이전트 서비스에 연결하지 못했습니다.";
}
