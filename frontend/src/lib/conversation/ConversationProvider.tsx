import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { conversationClient } from "./conversationClient";
import { AgentRuntimeError } from "../agentRuntime/agentClient";
import { explainAgentError } from "../agentRuntime/explain";
import { api } from "../apiClient";
import { analytics } from "../analytics";
import { probeLocalAgent } from "../bridge/localAgentHint";
import { useOptionalAuth } from "../auth";
import { CONVERSATION_KEY_PREFIX } from "../sessionScope";
import type { ConversationSurface } from "../analytics/events";
import type {
  ActiveTask,
  ConversationSummary,
  PendingHumanAction,
  ProgressStageEvent,
  StartTurnRequest,
  TurnView,
  WorkingSetView,
} from "./types";

/**
 * ONE conversation per app, shared by the home workspace and the contextual panel (Agentic Operating
 * Workspace v2 §3-A). The two surfaces render the same turns; a sentence typed beside the inquiry
 * list continues the thread the seller started on the home.
 *
 * <b>What it holds it was given.</b> Turns come from the runtime; the only client-composed turns are
 * `local` ones (the home's proactive opener, a palette shortcut) and they are never sent anywhere or
 * persisted. Hints (`productId` / `workItemId` / `channelCode` / `surface`) travel as request FIELDS —
 * the sentence is carried as typed.
 *
 * <b>Nothing here writes.</b> No publish, no approval, no channel call. The one seller-pressed
 * collection lives in the artifact that offers it, not here (`conversationWriteFence.test.ts`). The
 * pending-action watcher only READS sync runs to notice that the seller's action finished — for a
 * guided acquisition (NAVER export · Coupang WING read) the artifact resumes on the run's own
 * `COMPLETED`, and this watcher is the second, backend-side signal (a SyncJob after `requestedAt`).
 */
export interface TurnHints {
  productId?: string;
  workItemId?: string;
  channelCode?: string;
  surface?: string;
}

/** A turn on screen. `local` turns were composed by this client and exist only in this tab. */
export interface DisplayTurn extends TurnView {
  local?: boolean;
}

export interface ConversationState {
  readonly conversationId: string | null;
  readonly turns: DisplayTurn[];
  readonly busy: boolean;
  /** Seconds the current turn has been in flight. 0 when idle. */
  readonly elapsed: number;
  /** Only the stages the runtime reported for the turn in flight, in arrival order. */
  readonly stages: ProgressStageEvent[];
  readonly error: string | null;
  readonly pendingHumanAction: PendingHumanAction | null;
  readonly workingSet: WorkingSetView | null;
  /** Agent Interaction Model v2 §1-C: the task in flight for the selected object, as the runtime last said. */
  readonly activeTask: ActiveTask | null;
  /** A turn failed because free-text planning is off for this org — the box is disabled after that. */
  readonly plannerOff: boolean;
  send(text: string, hints?: TurnHints, surface?: ConversationSurface): Promise<void>;
  resume(turnId: string): Promise<void>;
  /**
   * Knowledge Capture v1: 「저장하고 계속」 / 「취소」 on a candidate card. Nothing is written here — the
   * decision travels to the runtime bound to the capture id and the fingerprint of the sentence shown,
   * and the runtime writes (through the seller's own knowledge seam) only on a matching SAVE.
   */
  decideCapture(captureId: string, fingerprint: string, decision: "SAVE" | "CANCEL"): Promise<void>;
  /** §3/§9: a click on a shown inquiry row — the same focus transition as naming it. Never blocks the composer. */
  selectEntity(target: { inquiryId: string; workItemId?: string | null }): Promise<void>;
  /** Working Context v1 §1: leave the anchored object. The same contract backwards; the set stays. */
  clearSelection(): Promise<void>;
  /**
   * Stop the turn in flight. Bounded and honest: the stream is closed, the runtime cancels the run's
   * budget (the step already running finishes on its own; nothing new starts), and the thread shows
   * 「요청을 중지했습니다」 — never a half-answer, never a claim that what already ran was undone.
   */
  stop(): void;
  /** Bumps when the thread list may have changed (a turn landed, a conversation was opened or started). */
  readonly historyVersion: number;
  newConversation(): void;
  loadHistory(limit?: number): Promise<ConversationSummary[]>;
  openConversation(id: string): Promise<void>;
  /** Append a client-only pair (seller sentence → agent turn). Never sent, never persisted. */
  addLocalTurn(text: string | null, agent: Pick<TurnView, "message" | "artifacts"> & Partial<TurnView>): void;
}

const ConversationContext = createContext<ConversationState | null>(null);

/**
 * The remembered-conversation pointer is namespaced BY ORG (Agent Interaction Model v2 §0): a machine
 * that signs into two organizations must never hand one org's thread id to the other's session. The
 * legacy un-namespaced key is neither read nor written; `clearSessionScopedState` removes it.
 */
export function currentKeyFor(orgId: string | null): string | null {
  return orgId ? `${CONVERSATION_KEY_PREFIX}.${orgId}` : null;
}

function readCurrent(key: string | null): string | null {
  if (!key) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeCurrent(key: string | null, id: string | null): void {
  if (!key) return;
  try {
    if (id) window.localStorage.setItem(key, id);
    else window.localStorage.removeItem(key);
  } catch {
    // storage unavailable — the id lives in memory for this tab
  }
}

let localSeq = 0;

/** Mirrors the runtime's `CANCELLED_MESSAGE` — the same sentence whether the stop is read live or after a reload. */
export const STOPPED_MESSAGE = "요청을 중지했습니다. 이미 시작된 확인은 되돌리지 않습니다.";

function agentStatus(turn: TurnView): "done" | "failed" | "waiting_human" {
  if (turn.status === "FAILED") return "failed";
  if (turn.status === "WAITING_HUMAN") return "waiting_human";
  return "done";
}

function humanActionLabel(type: PendingHumanAction["actionType"]): "review_import" | "channel_connect" | "knowledge_entry" | "variant_clarification" {
  switch (type) {
    case "REVIEW_IMPORT":
      return "review_import";
    case "CHANNEL_CONNECT":
      return "channel_connect";
    case "KNOWLEDGE_ENTRY":
      return "knowledge_entry";
    case "VARIANT_CLARIFICATION":
      return "variant_clarification";
  }
}

/** A sync run that finished after the action was requested, and did not fail — the seller's action landed. */
export function completedAfter(runs: Array<{ finishedAt: string | null; status: string }>, requestedAt: string): boolean {
  const since = Date.parse(requestedAt);
  return runs.some(
    (run) =>
      run.finishedAt != null &&
      Date.parse(run.finishedAt) > since &&
      (run.status === "SUCCESS" || run.status === "PARTIAL"),
  );
}

/**
 * Which runs on the requested channel are THIS step (Acceptance Closure §5). Two shapes of one fact: a
 * connector or guided run is stamped with the account — it must be the requested one; a seller-center export
 * ingest or a file upload carries no account, only the channel and `uploadType` — it must be upload-shaped and
 * of the requested type. A run another account started on the same channel is never this step.
 */
export function runsOfThisStep(
  runs: Array<{ sellerAccountId: string | null; channelId: string | null; dataType: string | null; uploadType: string | null; finishedAt: string | null; status: string }>,
  pending: { accountId: string; channelId: string | null; dataType: string },
) {
  return runs.filter((run) => {
    if (run.sellerAccountId != null) return run.sellerAccountId === pending.accountId && (run.dataType ?? run.uploadType) === pending.dataType;
    return pending.channelId != null && run.channelId === pending.channelId && run.uploadType === pending.dataType;
  });
}

const POLL_MS = 5_000;
const POLL_LIMIT = 15 * 60 * 1000;

export function ConversationProvider({ children }: { children: ReactNode }) {
  const orgId = useOptionalAuth()?.user?.orgId ?? null;
  const storageKey = currentKeyFor(orgId);
  const keyRef = useRef(storageKey);
  keyRef.current = storageKey;
  const [conversationId, setConversationId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : readCurrent(storageKey),
  );
  const [turns, setTurns] = useState<DisplayTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [stages, setStages] = useState<ProgressStageEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingHumanAction, setPending] = useState<PendingHumanAction | null>(null);
  const [workingSet, setWorkingSet] = useState<WorkingSetView | null>(null);
  const [activeTask, setActiveTask] = useState<ActiveTask | null>(null);
  const [plannerOff, setPlannerOff] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const idRef = useRef<string | null>(conversationId);
  idRef.current = conversationId;
  const abortRef = useRef<AbortController | null>(null);

  const adopt = useCallback((view: { conversationId: string; turns: TurnView[]; pendingHumanAction: PendingHumanAction | null; workingSet: WorkingSetView | null }) => {
    setConversationId(view.conversationId);
    writeCurrent(keyRef.current, view.conversationId);
    setTurns(view.turns);
    setPending(view.pendingHumanAction);
    setWorkingSet(view.workingSet);
    setActiveTask(view.turns[view.turns.length - 1]?.continuation.activeTask ?? null);
  }, []);

  // The remembered conversation FOR THIS ORG, if the runtime still has it. A 404 (runtime restarted,
  // memory store, another org's stale pointer) is a fresh start, not an error the seller reads.
  // When the signed-in org changes while mounted, every piece of the previous org's thread state resets.
  useEffect(() => {
    abortRef.current?.abort();
    idRef.current = null;
    setConversationId(null);
    setTurns([]);
    setPending(null);
    setWorkingSet(null);
    setActiveTask(null);
    setError(null);
    const id = readCurrent(storageKey);
    if (!id) return;
    let live = true;
    conversationClient
      .getConversation(id)
      .then((view) => {
        if (live) adopt(view);
      })
      .catch((err) => {
        if (!live) return;
        if (err instanceof AgentRuntimeError && err.status === 404) {
          writeCurrent(keyRef.current, null);
          setConversationId(null);
        }
      });
    return () => {
      live = false;
    };
  }, [adopt, storageKey]);

  useEffect(() => {
    if (!busy) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  const ensureId = useCallback(async (): Promise<string> => {
    if (idRef.current) return idRef.current;
    const created = await conversationClient.createConversation();
    idRef.current = created.conversationId;
    setConversationId(created.conversationId);
    writeCurrent(keyRef.current, created.conversationId);
    analytics.track("conversation_started");
    return created.conversationId;
  }, []);

  const appendAgent = useCallback((turn: TurnView) => {
    setTurns((prev) => [...prev, turn]);
    setPending(turn.continuation.pendingHumanAction);
    if (turn.continuation.workingSet) setWorkingSet(turn.continuation.workingSet);
    setActiveTask(turn.continuation.activeTask ?? null);
    if (turn.status === "FAILED" && turn.failureCode === "PLANNER_CAPABILITY_OFF") setPlannerOff(true);
    analytics.track("agent_result_shown", { status: agentStatus(turn) });
    for (const artifact of turn.artifacts) {
      analytics.track("artifact_shown", { type: artifact.type.toLowerCase() as Lowercase<typeof artifact.type> });
    }
    if (turn.continuation.pendingHumanAction) {
      analytics.track("human_action_requested", { type: humanActionLabel(turn.continuation.pendingHumanAction.actionType) });
    }
  }, []);

  const run = useCallback(
    /**
     * @param enrich a last piece of the request that costs a round trip to learn. Applied AFTER the
     *     seller's sentence is on screen, never before it — the local-helper probe is a hint about
     *     which guided path the runtime may name, and no hint outranks showing someone their own words.
     */
    async (request: StartTurnRequest, userText: string | null,
           enrich?: (r: StartTurnRequest) => Promise<StartTurnRequest>) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      setStages([]);
      const controller = new AbortController();
      abortRef.current = controller;
      // <b>The seller's own sentence is drawn before anything is awaited</b> (Agent Responsiveness v1
      // §4). It used to be appended after `ensureId()`, so on the first message of a conversation the
      // words the seller had just typed sat invisible for a round trip — and `send` awaited the local
      // helper probe before even that, up to 1.5s for a paired browser. Neither wait is about the
      // sentence, and neither has any business standing in front of it: the composer clears, the bubble
      // appears, and the network starts underneath it.
      if (userText !== null) {
        setTurns((prev) => [
          ...prev,
          {
            turnId: `local-user-${++localSeq}`,
            conversationId: idRef.current ?? "local",
            role: "USER",
            text: userText,
            message: "",
            artifacts: [],
            suggestedActions: [],
            continuation: { workingSet: null, pendingHumanAction: null, pendingPrepared: null },
            status: "DONE",
            createdAt: new Date().toISOString(),
            local: true,
          },
        ]);
      }
      try {
        const [id, enriched] = await Promise.all([
          ensureId(),
          enrich ? enrich(request).catch(() => request) : Promise.resolve(request),
        ]);
        const turn = await conversationClient.sendTurn(id, enriched, (event) => {
          if (event.type === "stage") setStages((prev) => [...prev, event]);
        }, controller.signal);
        appendAgent(turn);
      } catch (err) {
        if (controller.signal.aborted) {
          // The seller's own Stop — a recorded fact in the thread, not an error to read.
          setTurns((prev) => [...prev, {
            turnId: `local-stop-${++localSeq}`, conversationId: idRef.current ?? "local", role: "AGENT",
            message: STOPPED_MESSAGE, artifacts: [], suggestedActions: [],
            continuation: { workingSet: null, pendingHumanAction: null, pendingPrepared: null },
            status: "FAILED", failureCode: "CANCELLED", createdAt: new Date().toISOString(), local: true,
          }]);
          analytics.track("conversation_turn_stopped");
        } else {
          setError(explainAgentError(err));
        }
      } finally {
        abortRef.current = null;
        setBusy(false);
        setStages([]);
        setHistoryVersion((v) => v + 1);
      }
    },
    [busy, ensureId, appendAgent],
  );

  const send = useCallback(
    async (text: string, hints: TurnHints = {}, surface: ConversationSurface = "home") => {
      const trimmed = text.trim();
      if (!trimmed) return;
      analytics.track("conversation_turn_sent", { surface });
      await run(
        {
          text: trimmed,
          ...(hints.productId ? { productId: hints.productId } : {}),
          ...(hints.workItemId ? { workItemId: hints.workItemId } : {}),
          ...(hints.channelCode && ["NAVER", "COUPANG", "CAFE24"].includes(hints.channelCode)
            ? { channelCode: hints.channelCode as StartTurnRequest["channelCode"] }
            : {}),
          ...(hints.surface ? { surface: hints.surface } : {}),
        },
        trimmed,
        // The helper probe — a hint, sent as one. Nothing is paired or opened here.
        async (request) => ({ ...request, localAgent: await probeLocalAgent().catch(() => "UNKNOWN" as const) }),
      );
    },
    [run],
  );

  const resume = useCallback(
    async (turnId: string) => {
      analytics.track("conversation_resumed");
      await run({ resumeOfTurnId: turnId }, null);
    },
    [run],
  );

  const decideCapture = useCallback(
    async (captureId: string, fingerprint: string, decision: "SAVE" | "CANCEL") => {
      // The runtime logs the decision; no client analytics event carries the sentence.
      await run({ captureDecision: { captureId, fingerprint, decision } }, decision === "SAVE" ? "저장하고 계속" : "취소");
    },
    [run],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const newConversation = useCallback(() => {
    abortRef.current?.abort();
    idRef.current = null;
    setConversationId(null);
    writeCurrent(keyRef.current, null);
    setTurns([]);
    setPending(null);
    setWorkingSet(null);
    setActiveTask(null);
    setError(null);
  }, []);

  const loadHistory = useCallback((limit = 10) => conversationClient.listConversations(limit), []);

  /**
   * Agent Interaction Model v2 §3/§9: a CLICK on a shown inquiry row is the same focus transition a
   * typed selection makes — sent to the runtime as a `select` turn (verified there, persisted with the
   * thread, appended to the transcript as nothing). The row's own highlight is the feedback; the next
   * sentence (「이 고객한테 뭐라고 답하면 좋을까?」) acts on exactly this inquiry.
   */
  const selectEntity = useCallback(async (target: { inquiryId: string; workItemId?: string | null }) => {
    try {
      const id = await ensureId();
      const turn = await conversationClient.sendTurn(
        id,
        { select: { kind: "INQUIRY", inquiryId: target.inquiryId, workItemId: target.workItemId ?? null } },
        () => undefined,
      );
      if (turn.continuation.workingSet) setWorkingSet(turn.continuation.workingSet);
      setActiveTask(turn.continuation.activeTask ?? null);
      analytics.track("conversation_object_selected");
    } catch {
      // Selection is a convenience over navigation — a failed one changes nothing and says nothing.
    }
  }, [ensureId]);

  /**
   * Working Context v1 §1: leaving the anchored object. The same focus contract, backwards — the
   * runtime drops the selection and the task in flight, and the set the seller is looking at stays.
   * On a failure the bar keeps showing what the runtime still holds; it never clears optimistically,
   * because a bar that says 「해제됨」 while the next turn is still anchored is the defect it exists
   * to close.
   */
  const clearSelection = useCallback(async () => {
    const id = idRef.current;
    if (!id) return;
    try {
      const turn = await conversationClient.sendTurn(id, { select: { kind: "CLEAR" } }, () => undefined);
      setWorkingSet(turn.continuation.workingSet);
      setActiveTask(turn.continuation.activeTask ?? null);
    } catch {
      // Nothing changed on the server; nothing changes here.
    }
  }, []);

  const openConversation = useCallback(
    async (id: string) => {
      const view = await conversationClient.getConversation(id);
      idRef.current = view.conversationId;
      adopt(view);
      setError(null);
      setHistoryVersion((v) => v + 1);
    },
    [adopt],
  );

  const addLocalTurn = useCallback<ConversationState["addLocalTurn"]>((text, agent) => {
    const id = idRef.current ?? "local";
    const now = new Date().toISOString();
    const base = {
      conversationId: id,
      suggestedActions: [],
      continuation: { workingSet: null, pendingHumanAction: null, pendingPrepared: null },
      status: "DONE" as const,
      createdAt: now,
      local: true,
    };
    setTurns((prev) => [
      ...prev,
      ...(text !== null
        ? [{ ...base, turnId: `local-user-${++localSeq}`, role: "USER" as const, text, message: "", artifacts: [] }]
        : []),
      { ...base, ...agent, turnId: agent.turnId ?? `local-agent-${++localSeq}`, role: "AGENT" as const },
    ]);
  }, []);

  // While the seller's one-step action is pending and this tab is visible, notice when it lands.
  const pendingRef = useRef(pendingHumanAction);
  pendingRef.current = pendingHumanAction;
  const resumeRef = useRef(resume);
  resumeRef.current = resume;
  useEffect(() => {
    if (!pendingHumanAction || !pendingHumanAction.accountId || !pendingHumanAction.dataType) return;
    const { accountId, dataType, requestedAt, turnId, actionType } = pendingHumanAction;
    const started = Date.now();
    let stopped = false;
    // The account's channel, read once: an export ingest is stamped with the channel, not the account.
    const channelIdOf: Promise<string | null> = api
      .getSellerAccountsStrict()
      .then((accounts) => accounts.find((a) => a.id === accountId)?.channelId ?? null)
      .catch(() => null);
    const timer = window.setInterval(() => {
      if (stopped) return;
      if (Date.now() - started > POLL_LIMIT) {
        window.clearInterval(timer);
        return;
      }
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void channelIdOf
        .then((channelId) => Promise.all([
          api.getSyncRunsStrict({ sellerAccountId: accountId, dataType }),
          channelId ? api.getSyncRunsStrict({ channelId }) : Promise.resolve([]),
        ]).then(([mine, onChannel]) => runsOfThisStep([...mine, ...onChannel], { accountId, channelId, dataType })))
        .then((runs) => {
          if (stopped || pendingRef.current?.turnId !== turnId) return;
          if (completedAfter(runs, requestedAt)) {
            stopped = true;
            window.clearInterval(timer);
            analytics.track("human_action_completed", { type: humanActionLabel(actionType) });
            void resumeRef.current(turnId);
          }
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [pendingHumanAction]);

  const value = useMemo<ConversationState>(
    () => ({
      conversationId,
      turns,
      busy,
      elapsed,
      stages,
      error,
      pendingHumanAction,
      workingSet,
      activeTask,
      plannerOff,
      send,
      resume,
      decideCapture,
      selectEntity,
      clearSelection,
      stop,
      historyVersion,
      newConversation,
      loadHistory,
      openConversation,
      addLocalTurn,
    }),
    [conversationId, turns, busy, elapsed, stages, error, pendingHumanAction, workingSet, activeTask, plannerOff, send, resume, decideCapture, selectEntity, clearSelection, stop, historyVersion, newConversation, loadHistory, openConversation, addLocalTurn],
  );
  return <ConversationContext.Provider value={value}>{children}</ConversationContext.Provider>;
}

/** Null outside the app shell (tests render pages bare); callers render nothing conversational then. */
export function useConversation(): ConversationState | null {
  return useContext(ConversationContext);
}
