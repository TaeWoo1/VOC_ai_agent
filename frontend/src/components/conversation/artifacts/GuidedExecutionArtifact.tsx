import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { GuidedExecutionArtifact as GuidedExecution } from "../../../lib/conversation/types";
import type { ReviewExecutionView } from "../../../lib/types";
import { api } from "../../../lib/apiClient";
import { newCommandId } from "../../../lib/commandId";
import { copyText } from "../../../lib/clipboard";
import { startReplySubmission, type ReplyRunHandle, type ReplyRuntime, type ReplySignal } from "../../../lib/actionWindow/reply/replyRuntime";
import { useReplyRuntime } from "../../../lib/actionWindow/reply/useReplyRuntime";
import { useBridge } from "../../../hooks/useBridge";
import { AgentPairingPanel } from "../../reviewImport/AgentPairingPanel";
import { Btn } from "../../ui/Btn";
import { ArtifactCard } from "./ArtifactCard";
import { ExecutionResultView } from "./ExecutionResultArtifact";

/**
 * <b>The only conversation module allowed to mint a submission run and drive the reply runtime.</b>
 *
 * NAVER has no reply API reviewnary may call, so the approved draft reaches the review through the
 * seller's own seller-center window: the local helper finds the exact review, opens its composer,
 * fills the approved text ONLY when the row and the review fingerprint both match, and then stops —
 * 등록은 판매자님이 누릅니다. There is no submit control here and never will be: the only commands this
 * card can send are the run's own `START_RUN` and the seller's report (「그만두기」 · 「등록을 마쳤습니다」),
 * both of which the contract defines as intent, never as completion.
 *
 * What the seller reads is which stage the helper reached (stage words below), and afterwards an
 * EXECUTION_RESULT whose verification is what was actually observed — `SELLER_SUBMISSION_OBSERVED` when
 * the helper saw the submit, otherwise the backend's read-back — never a claim about what was posted.
 */
export function GuidedExecutionArtifact({ artifact, replyRuntime }: { artifact: GuidedExecution; replyRuntime?: ReplyRuntime }) {
  const [engaged, setEngaged] = useState(false);
  const [done, setDone] = useState(false);
  const meta = [artifact.channelNameKo, artifact.draftVersion != null ? `답변 버전 ${artifact.draftVersion}` : null].filter(Boolean).join(" · ") || null;
  const channel = artifact.channelNameKo ?? "네이버";

  return (
    <ArtifactCard title={artifact.title} note={meta} testId="guided-execution-artifact" framed>
      <div className="space-y-3 px-4 pb-3">
        <p className="break-keep text-sm text-muted">
          reviewnary가 {channel} 판매자센터에서 이 리뷰의 답변란을 찾아 승인한 초안을 채웁니다. 등록은 판매자님이 직접 누릅니다.
        </p>
        {!engaged ? (
          <div className="flex flex-wrap items-center gap-2">
            <Btn onClick={() => setEngaged(true)}>{channel}에서 답변하기</Btn>
            <span className="text-sm text-muted">내 PC의 도우미가 필요합니다.</span>
          </div>
        ) : (
          <GuidedReplyRun artifact={artifact} injected={replyRuntime} onDone={() => setDone(true)} />
        )}
        {!done ? (
          <p className="text-sm">
            {/* The link now opens THIS review's reply work, not the channel's whole record, so it says
              what it opens. A link named after a screen was accurate when it went to one. */}
          <Link to={artifact.to} className="font-semibold text-brand-700 hover:underline">이 리뷰의 답변 작업 열기</Link>
          </p>
        ) : null}
      </div>
    </ArtifactCard>
  );
}

/** The stage words, in the order the helper reaches them. The last one is the seller's, not ours. */
export const STAGE_WORDS = ["리뷰 찾는 중", "답변란 준비", "초안 채움", "등록은 판매자님이 누릅니다"] as const;
type StageIndex = 0 | 1 | 2 | 3;

/** Which stage a sanitized run signal proves reached. Unknown signals prove nothing (null). */
export function stageOf(signal: ReplySignal): StageIndex | null {
  const step = signal.stepId ?? "";
  switch (signal.type) {
    case "RUN_STARTED":
      return 0;
    case "STEP_READY":
    case "TARGET_HIGHLIGHTED":
    case "HUMAN_ACTION_REQUIRED":
      return step.includes("reply_submit") ? 1 : step.includes("review_row") ? 0 : null;
    case "COMPOSER_FILLED":
      return 2;
    case "SELLER_SUBMISSION_OBSERVED":
      return 3;
    default:
      return null;
  }
}

/** True when the signal says the seller's own submit was seen by the helper. */
export function submissionObserved(signal: ReplySignal): boolean {
  return signal.type === "SELLER_SUBMISSION_OBSERVED";
}

type Phase =
  | { kind: "connecting" }
  | { kind: "no_runtime" }
  | { kind: "starting" }
  | { kind: "running"; stage: StageIndex }
  | { kind: "failed"; message: string }
  | { kind: "aborted" }
  | { kind: "done"; phase: string; verification: string | null };

const POLL_MS = 4_000;

function GuidedReplyRun({ artifact, injected, onDone }: { artifact: GuidedExecution; injected?: ReplyRuntime; onDone: () => void }) {
  // The helper is asked to pair by the seller's own press (the primary above), once — never on mount of a
  // reloaded conversation, which is why the bridge hook lives inside the engaged branch.
  const bridge = useBridge(!injected, { autoPair: true });
  const runtime = useReplyRuntime(injected);
  const paired = !!injected || bridge.state.phase === "paired";
  const [phase, setPhase] = useState<Phase>({ kind: "connecting" });
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const handleRef = useRef<ReplyRunHandle | null>(null);
  const submissionRef = useRef<string | null>(null);
  const startedRef = useRef(false);
  const stageRef = useRef<StageIndex>(0);

  // Paired but nothing hosts the reply carrier: say so, offer the copy path. Not a failure of pairing.
  useEffect(() => {
    if (!paired || runtime || startedRef.current) return;
    const timer = setTimeout(() => setPhase((p) => (p.kind === "connecting" ? { kind: "no_runtime" } : p)), 6_000);
    return () => clearTimeout(timer);
  }, [paired, runtime]);

  // Mint the single-use binding, then start the run — once, and only after a runtime exists.
  useEffect(() => {
    if (!paired || !runtime || startedRef.current) return;
    startedRef.current = true;
    let live = true;
    setPhase({ kind: "starting" });
    void (async () => {
      try {
        const run = await api.startReviewReplySubmissionRun(artifact.accountId, artifact.actionRef);
        submissionRef.current = run.submissionRef;
        const handle = await startReplySubmission(runtime, { channelCode: "naver", submissionRef: run.submissionRef });
        if (!live) return;
        handleRef.current = handle;
        setPhase({ kind: "running", stage: 0 });
      } catch {
        if (live) setPhase({ kind: "failed", message: "답변 안내를 시작하지 못했습니다. 초안을 복사해 직접 등록해 주세요." });
      }
    })();
    return () => {
      live = false;
    };
  }, [paired, runtime, artifact.accountId, artifact.actionRef]);

  // Stage words from the run's own sanitized events. Absent `observe` (simulated runtime) ⇒ no words.
  useEffect(() => {
    if (!runtime?.observe) return;
    return runtime.observe((signal) => {
      if (submissionObserved(signal)) {
        setPhase({ kind: "done", phase: "OPERATOR_REPORTED", verification: "SELLER_SUBMISSION_OBSERVED" });
        return;
      }
      const stage = stageOf(signal);
      if (stage == null) return;
      if (stage > stageRef.current) stageRef.current = stage;
      setPhase((p) => (p.kind === "running" ? { kind: "running", stage: stageRef.current } : p));
    });
  }, [runtime]);

  // Second source, backend-side: the observed states the collector reported. A READ, bounded to the run.
  useEffect(() => {
    if (phase.kind !== "running") return;
    let stopped = false;
    const timer = window.setInterval(() => {
      void api
        .getReviewReplyExecution(artifact.accountId, artifact.actionRef)
        .then((view: ReviewExecutionView | null) => {
          if (stopped || !view) return;
          if (view.verification === "SELLER_SUBMISSION_OBSERVED" || view.verification === "SUBMISSION_OBSERVED_CONTENT_UNVERIFIED") {
            setPhase({ kind: "done", phase: view.status, verification: view.verification });
          } else if (view.verification === "COMPOSER_FILLED" && stageRef.current < 2) {
            stageRef.current = 2;
            setPhase((p) => (p.kind === "running" ? { kind: "running", stage: 2 } : p));
          }
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [phase.kind, artifact.accountId, artifact.actionRef]);

  async function report(outcome: "submitted" | "aborted") {
    const handle = handleRef.current;
    if (!handle) return;
    try {
      const terminal = outcome === "submitted" ? await handle.reportSubmitted() : await handle.abortSubmission();
      if (submissionRef.current) {
        // The existing operator-reported record (UNVERIFIED by construction) — local, never a channel claim.
        await api
          .recordReviewReplyOutcome(artifact.accountId, artifact.actionRef, {
            commandId: newCommandId(),
            submissionRef: submissionRef.current,
            operatorOutcome: terminal.operatorOutcome,
            awRunRef: terminal.runId,
          })
          .catch(() => undefined);
      }
      if (outcome === "aborted") {
        setPhase({ kind: "aborted" });
        return;
      }
      const view = await api.getReviewReplyExecution(artifact.accountId, artifact.actionRef).catch(() => null);
      setPhase({ kind: "done", phase: "OPERATOR_REPORTED", verification: view?.verification ?? null });
    } catch {
      setPhase({ kind: "failed", message: "보고를 기록하지 못했습니다. 리뷰 화면에서 다시 시도해 주세요." });
    }
  }

  async function copy() {
    const prep = await api.getReviewReplyPrep(artifact.accountId, artifact.actionRef).catch(() => null);
    const body = prep?.approval?.state === "APPROVED" ? prep.approval.approvedBody : null;
    if (!body) {
      setCopied("failed");
      return;
    }
    const result = await copyText(body);
    setCopied(result.ok ? "done" : "failed");
  }

  if (!paired) {
    return (
      <div className="space-y-2">
        <AgentPairingPanel
          phase={bridge.state.phase}
          confirmationCode={bridge.state.confirmationCode}
          confirmUrl={bridge.state.confirmUrl}
          attestedApproval={bridge.state.attestedApproval}
          pairingHint={bridge.state.pairingHint}
          maybeNeedsLocalNetworkAccess={bridge.state.maybeNeedsLocalNetworkAccess}
          onConnect={bridge.requestPairing}
          onRetry={bridge.retry}
        />
        <CopyFallback copied={copied} onCopy={copy} />
      </div>
    );
  }

  // The result view carries its own link; tell the card so it does not draw a second one.
  useEffect(() => {
    if (phase.kind === "done") onDone();
  }, [phase.kind, onDone]);

  if (phase.kind === "done") {
    return (
      <div data-testid="guided-execution-result">
        <ExecutionResultView phase={phase.phase} category="" verification={phase.verification} objectKind="REVIEW" to={artifact.to} />
      </div>
    );
  }
  if (phase.kind === "aborted") {
    return <p className="break-keep text-sm text-muted" role="status">등록하지 않고 마쳤습니다. 리뷰는 그대로 남아 있습니다.</p>;
  }
  if (phase.kind === "failed" || phase.kind === "no_runtime") {
    return (
      <div className="space-y-2">
        <p className="break-keep text-sm text-warn" role="status">
          {phase.kind === "failed" ? phase.message : "연결된 도우미가 답변 안내를 지원하지 않습니다. 초안을 복사해 직접 등록해 주세요."}
        </p>
        <CopyFallback copied={copied} onCopy={copy} />
      </div>
    );
  }
  if (phase.kind === "connecting" || phase.kind === "starting") {
    return <p className="text-sm text-muted" role="status">{phase.kind === "starting" ? "답변란을 준비하는 중…" : "도우미와 연결하는 중…"}</p>;
  }

  return (
    <div className="space-y-3" data-testid="guided-execution-run">
      <ol className="space-y-1" aria-label="진행 단계">
        {STAGE_WORDS.map((word, i) => (
          <li key={word} className={`flex items-center gap-2 text-sm ${i <= phase.stage ? "text-ink" : "text-muted"}`}>
            <span aria-hidden="true" className={i < phase.stage ? "text-good" : i === phase.stage ? "text-brand-700" : "text-line"}>
              {i < phase.stage ? "✓" : "○"}
            </span>
            <span>{word}</span>
          </li>
        ))}
      </ol>
      <p className="break-keep text-sm text-muted">판매자센터 창에서 등록 버튼을 누르면 reviewnary가 그것을 확인합니다.</p>
      <div className="flex flex-wrap gap-2">
        <Btn variant="outline" size="sm" onClick={() => void report("submitted")}>등록을 마쳤습니다</Btn>
        <Btn variant="ghost" size="sm" onClick={() => void report("aborted")}>그만두기</Btn>
      </div>
    </div>
  );
}

function CopyFallback({ copied, onCopy }: { copied: "idle" | "done" | "failed"; onCopy: () => void }) {
  return (
    <div className="space-y-1">
      <Btn variant="outline" size="sm" onClick={onCopy}>{copied === "done" ? "복사했습니다" : "승인한 답변 복사"}</Btn>
      {copied === "failed" ? <p className="text-sm text-muted">복사할 승인 답변이 없거나 이 브라우저에서는 복사할 수 없습니다.</p> : null}
    </div>
  );
}
