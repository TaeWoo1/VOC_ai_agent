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
import { Status } from "../../ui/Status";
import { ArtifactCard } from "./ArtifactCard";
import { ExecutionResultView } from "./ExecutionResultArtifact";

/**
 * <b>The only conversation module allowed to mint a submission run and drive the reply runtime.</b>
 *
 * NAVER has no reply API reviewnary may call, so the approved draft reaches the review through the
 * seller's own seller-center window: the local helper finds the exact review, opens its composer,
 * fills the approved text ONLY when the row and the review fingerprint both match, and then stops —
 * 등록은 판매자님이 누릅니다. There is no submit control here and never will be: the only commands this
 * card can send are the run's own `START_RUN` and the seller's report, both of which the contract
 * defines as intent, never as completion.
 *
 * Guided Reply UX Smoothing v1 §2–§4 moved the action out of this card and left the machinery in it:
 * {@link GuidedReplyAction} is the whole guided lane (engage → pair → mint → run → filled), and the
 * in-chat approval card renders the same component once the seller's approval stands. This card stays
 * as the entry for a review that ALREADY carries a standing approval.
 */
export function GuidedExecutionArtifact({ artifact, replyRuntime }: { artifact: GuidedExecution; replyRuntime?: ReplyRuntime }) {
  const meta = [artifact.channelNameKo, artifact.draftVersion != null ? `답변 버전 ${artifact.draftVersion}` : null].filter(Boolean).join(" · ") || null;
  return (
    <ArtifactCard title={artifact.title} note={meta} testId="guided-execution-artifact" framed>
      <div className="px-4 pb-3">
        <GuidedReplyAction
          target={{ accountId: artifact.accountId, actionRef: artifact.actionRef, channelNameKo: artifact.channelNameKo, to: artifact.to }}
          replyRuntime={replyRuntime}
        />
      </div>
    </ArtifactCard>
  );
}

/** Everything the guided lane needs about the review it is acting on. Ids and one link — no text. */
export interface GuidedReplyTarget {
  accountId: string;
  actionRef: string;
  channelNameKo: string | null;
  /** The precision surface for this one reply (edit / recover). Never the normal path. */
  to: string;
}

/**
 * The one primary that follows a standing approval: 「{채널}에 입력하기」, then the run itself.
 *
 * The seller is not sent to another screen and back. The window opens, the helper works, and the same
 * card reports what happened — in the conversation that already knows which review this is.
 */
export function GuidedReplyAction({ target, replyRuntime }: { target: GuidedReplyTarget; replyRuntime?: ReplyRuntime }) {
  const [engaged, setEngaged] = useState(false);
  const [done, setDone] = useState(false);
  const channel = target.channelNameKo ?? "네이버";

  return (
    <div className="space-y-3">
      {!engaged ? (
        <>
          <p className="break-keep text-sm text-muted">
            reviewnary가 {channel} 판매자센터에서 이 리뷰의 답글 입력칸을 찾아 승인한 답변을 넣어 둡니다. 등록은 판매자님이 직접 누릅니다.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Btn onClick={() => setEngaged(true)}>{channel}에 입력하기</Btn>
            <span className="text-sm text-muted">내 PC의 도우미가 필요합니다.</span>
          </div>
        </>
      ) : (
        <GuidedReplyRun target={target} injected={replyRuntime} onDone={() => setDone(true)} />
      )}
      {!done ? (
        // The precision surface, kept quiet: the normal path is this card, and a seller who needs to
        // change the text goes there deliberately rather than being routed through it (§2).
        <p className="text-sm">
          <Link to={target.to} className="text-muted hover:text-ink hover:underline">이 리뷰의 답변 작업 열기</Link>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The three things the helper does, in the seller's words (Guided Reply UX Smoothing v1 §3).
 *
 * There used to be a fourth line, 「등록은 판매자님이 누릅니다」, sitting in the list as a step nobody
 * could ever tick: it is not something the helper does, it is what is true after it stops. It now has
 * its own state below, which is where the seller reads it.
 */
export const STAGE_WORDS = ["리뷰 확인", "답글창 준비", "승인한 초안 입력"] as const;
type StageIndex = 0 | 1 | 2;

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
  | { kind: "filled" }
  | { kind: "failed"; message: string }
  | { kind: "aborted" }
  | { kind: "done"; phase: string; verification: string | null };

const POLL_MS = 4_000;

function GuidedReplyRun({ target, injected, onDone }: { target: GuidedReplyTarget; injected?: ReplyRuntime; onDone: () => void }) {
  // The helper is asked to pair by the seller's own press (the primary above), once — never on mount of a
  // reloaded conversation, which is why the bridge hook lives inside the engaged branch.
  const bridge = useBridge(!injected, { autoPair: true });
  const runtime = useReplyRuntime(injected);
  const paired = !!injected || bridge.state.phase === "paired";
  const [phase, setPhase] = useState<Phase>({ kind: "connecting" });
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const [reporting, setReporting] = useState(false);
  const [raiseFailed, setRaiseFailed] = useState(false);
  const handleRef = useRef<ReplyRunHandle | null>(null);
  const submissionRef = useRef<string | null>(null);
  const startedRef = useRef(false);
  const stageRef = useRef<StageIndex>(0);
  const filledRef = useRef<HTMLDivElement>(null);
  const channel = target.channelNameKo ?? "네이버";

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
        const run = await api.startReviewReplySubmissionRun(target.accountId, target.actionRef);
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
  }, [paired, runtime, target.accountId, target.actionRef]);

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
      if (stage === 2) {
        setPhase({ kind: "filled" });
        return;
      }
      setPhase((p) => (p.kind === "running" ? { kind: "running", stage: stageRef.current } : p));
    });
  }, [runtime]);

  // Second source, backend-side: the observed states the collector reported. A READ, bounded to the run.
  useEffect(() => {
    if (phase.kind !== "running") return;
    let stopped = false;
    const timer = window.setInterval(() => {
      void api
        .getReviewReplyExecution(target.accountId, target.actionRef)
        .then((view: ReviewExecutionView | null) => {
          if (stopped || !view) return;
          if (view.verification === "SELLER_SUBMISSION_OBSERVED" || view.verification === "SUBMISSION_OBSERVED_CONTENT_UNVERIFIED") {
            setPhase({ kind: "done", phase: view.status, verification: view.verification });
          } else if (view.verification === "COMPOSER_FILLED") {
            stageRef.current = 2;
            setPhase({ kind: "filled" });
          }
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [phase.kind, target.accountId, target.actionRef]);

  /**
   * **「네이버 창 앞으로」 — the window this run already opened, back in front of the seller.**
   *
   * It used to say 「네이버에서 확인」 and do nothing: the browser cannot focus a window the helper owns, so
   * the seller pressed a primary that changed nothing they could see. The helper CAN raise it — the same
   * `focusSurface` capability the three Coupang carriers have shipped since 2026-08-12 — so the button is
   * connected to that rather than renamed away.
   *
   * What it never claims: that the window came forward. The agent acknowledges the ask and reports no OS
   * outcome, so a `true` here means «asked» and prints nothing, while a refusal says plainly that the
   * seller has to find the window themselves. Either way the next step — telling reviewnary what happened
   * — is revealed, because the seller is going to look at that window now.
   */
  async function raiseAndReport() {
    setReporting(true);
    const asked = (await handleRef.current?.focusSurface()) ?? false;
    setRaiseFailed(!asked);
  }

  async function report(outcome: "submitted" | "aborted") {
    const handle = handleRef.current;
    if (!handle) return;
    try {
      const terminal = outcome === "submitted" ? await handle.reportSubmitted() : await handle.abortSubmission();
      if (submissionRef.current) {
        // The existing operator-reported record (UNVERIFIED by construction) — local, never a channel claim.
        await api
          .recordReviewReplyOutcome(target.accountId, target.actionRef, {
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
      const view = await api.getReviewReplyExecution(target.accountId, target.actionRef).catch(() => null);
      setPhase({ kind: "done", phase: "OPERATOR_REPORTED", verification: view?.verification ?? null });
    } catch {
      setPhase({ kind: "failed", message: "보고를 기록하지 못했습니다. 리뷰 화면에서 다시 시도해 주세요." });
    }
  }

  async function copy() {
    const prep = await api.getReviewReplyPrep(target.accountId, target.actionRef).catch(() => null);
    const body = prep?.approval?.state === "APPROVED" ? prep.approval.approvedBody : null;
    if (!body) {
      setCopied("failed");
      return;
    }
    const result = await copyText(body);
    setCopied(result.ok ? "done" : "failed");
  }

  useEffect(() => {
    if (phase.kind === "done") onDone();
  }, [phase.kind, onDone]);

  // The card GROWS when the helper reports the composer filled, and the transcript only re-pins itself
  // when a turn arrives or the dock resizes (`ConversationTimeline`'s `dockKey`) — neither happens here.
  // Measured at 1440/1366/1152: the primary 「{채널}에서 확인」 landed under the docked composer. Same
  // mechanism as the timeline's own trigger, scoped to the one state that changes height.
  useEffect(() => {
    if (phase.kind !== "filled") return;
    filledRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [phase.kind]);

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

  if (phase.kind === "done") {
    return (
      <div data-testid="guided-execution-result">
        <ExecutionResultView phase={phase.phase} category="" verification={phase.verification} objectKind="REVIEW" to={target.to} />
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

  // §4 — what is true when the helper stops: the text is in the box and nothing has been posted. The
  // seller's own report (「등록을 마쳤습니다」 / 「등록하지 않았습니다」) is a RECOVERY surface, so it is not
  // in front of them until they say they have been to look.
  if (phase.kind === "filled") {
    return (
      <div className="space-y-2" data-testid="guided-execution-filled" ref={filledRef}>
        <p className="break-keep text-lg leading-relaxed text-ink">
          {channel} 답글 입력칸에 승인한 답변을 준비했습니다.
        </p>
        <p className="flex flex-wrap items-center gap-2 text-base text-ink" role="status">
          <Status tone="warn">등록 전</Status>
          <span className="break-keep">아직 등록하지 않았습니다.</span>
        </p>
        <p className="break-keep text-sm text-muted">열린 {channel} 창에서 내용을 확인하고, 등록은 판매자님이 눌러 주세요.</p>
        {!reporting ? (
          <Btn onClick={() => void raiseAndReport()}>{channel} 창 앞으로</Btn>
        ) : (
          <div className="space-y-2" data-testid="guided-execution-report">
            {raiseFailed ? (
              <p className="break-keep text-sm text-muted" role="status">
                창을 앞으로 가져오지 못했습니다. 열려 있는 {channel} 창을 직접 확인해 주세요.
              </p>
            ) : null}
            <p className="break-keep text-sm text-muted">확인하셨다면 결과를 기록해 두겠습니다.</p>
            <div className="flex flex-wrap gap-2">
              <Btn variant="outline" size="sm" onClick={() => void report("submitted")}>등록을 마쳤습니다</Btn>
              <Btn variant="ghost" size="sm" onClick={() => void report("aborted")}>등록하지 않았습니다</Btn>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (phase.kind === "connecting" || phase.kind === "starting") {
    return <p className="text-sm text-muted" role="status">{phase.kind === "starting" ? "답글 입력칸을 준비하는 중…" : "도우미와 연결하는 중…"}</p>;
  }

  return (
    <div className="space-y-3" data-testid="guided-execution-run">
      <ol className="space-y-1" aria-label="진행 단계">
        {STAGE_WORDS.map((word, i) => (
          <li key={word} className={`flex items-center gap-2 text-sm ${i <= phase.stage ? "text-ink" : "text-muted"}`}>
            {/* A finished step keeps its ✓ — that glyph carries meaning, and it reads at AA. The
                circle never did: it is decoration, and as a text node it failed contrast at every
                width (measured 2026-09-03). Drawn, it cannot. */}
            <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center">
              {i < phase.stage ? (
                <span className="text-good">✓</span>
              ) : (
                <span className={`h-2 w-2 rounded-full ${i === phase.stage ? "bg-brand-700" : "bg-line"}`} />
              )}
            </span>
            <span>{word}</span>
          </li>
        ))}
      </ol>
      {/* §3 — a conditional instruction, not a claim about the page. reviewnary cannot see the seller's
          screen from here, and the run reports nothing while it waits: what IS true is that the window
          may open on a sign-in screen, and that signing in continues the run by itself. */}
      <p className="break-keep text-sm text-muted">
        로그인 화면이 보이면 열린 {channel} 창에서 로그인해 주세요. 로그인하면 자동으로 이어집니다.
      </p>
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
