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
import type { ConversationSurface } from "../analytics/events";
import type {
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
  /** A turn failed because free-text planning is off for this org — the box is disabled after that. */
  readonly plannerOff: boolean;
  send(text: string, hints?: TurnHints, surface?: ConversationSurface): Promise<void>;
  resume(turnId: string): Promise<void>;
  newConversation(): void;
  loadHistory(limit?: number): Promise<ConversationSummary[]>;
  openConversation(id: string): Promise<void>;
  /** Append a client-only pair (seller sentence → agent turn). Never sent, never persisted. */
  addLocalTurn(text: string | null, agent: Pick<TurnView, "message" | "artifacts"> & Partial<TurnView>): void;
}

const ConversationContext = createContext<ConversationState | null>(null);

export const CURRENT_KEY = "reviewnary.conversation.current";

function readCurrent(): string | null {
  try {
    return window.localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

function writeCurrent(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(CURRENT_KEY, id);
    else window.localStorage.removeItem(CURRENT_KEY);
  } catch {
    // storage unavailable — the id lives in memory for this tab
  }
}

let localSeq = 0;

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

const POLL_MS = 5_000;
const POLL_LIMIT = 15 * 60 * 1000;

export function ConversationProvider({ children }: { children: ReactNode }) {
  const [conversationId, setConversationId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : readCurrent(),
  );
  const [turns, setTurns] = useState<DisplayTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [stages, setStages] = useState<ProgressStageEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingHumanAction, setPending] = useState<PendingHumanAction | null>(null);
  const [workingSet, setWorkingSet] = useState<WorkingSetView | null>(null);
  const [plannerOff, setPlannerOff] = useState(false);
  const idRef = useRef<string | null>(conversationId);
  idRef.current = conversationId;

  const adopt = useCallback((view: { conversationId: string; turns: TurnView[]; pendingHumanAction: PendingHumanAction | null; workingSet: WorkingSetView | null }) => {
    setConversationId(view.conversationId);
    writeCurrent(view.conversationId);
    setTurns(view.turns);
    setPending(view.pendingHumanAction);
    setWorkingSet(view.workingSet);
  }, []);

  // The remembered conversation, if the runtime still has it. A 404 (runtime restarted, memory store)
  // is a fresh start, not an error the seller reads.
  useEffect(() => {
    const id = readCurrent();
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
          writeCurrent(null);
          setConversationId(null);
        }
      });
    return () => {
      live = false;
    };
  }, [adopt]);

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
    writeCurrent(created.conversationId);
    analytics.track("conversation_started");
    return created.conversationId;
  }, []);

  const appendAgent = useCallback((turn: TurnView) => {
    setTurns((prev) => [...prev, turn]);
    setPending(turn.continuation.pendingHumanAction);
    if (turn.continuation.workingSet) setWorkingSet(turn.continuation.workingSet);
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
    async (request: StartTurnRequest, userText: string | null) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      setStages([]);
      try {
        const id = await ensureId();
        if (userText !== null) {
          setTurns((prev) => [
            ...prev,
            {
              turnId: `local-user-${++localSeq}`,
              conversationId: id,
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
        const turn = await conversationClient.sendTurn(id, request, (event) => {
          if (event.type === "stage") setStages((prev) => [...prev, event]);
        });
        appendAgent(turn);
      } catch (err) {
        setError(explainAgentError(err));
      } finally {
        setBusy(false);
        setStages([]);
      }
    },
    [busy, ensureId, appendAgent],
  );

  const send = useCallback(
    async (text: string, hints: TurnHints = {}, surface: ConversationSurface = "home") => {
      const trimmed = text.trim();
      if (!trimmed) return;
      analytics.track("conversation_turn_sent", { surface });
      // A hint, sent as one: whether a local helper is paired decides which guided path the runtime may
      // name (Action Window vs file upload). Nothing is paired or opened here — a health probe only.
      const localAgent = await probeLocalAgent().catch(() => "UNKNOWN" as const);
      await run(
        {
          text: trimmed,
          localAgent,
          ...(hints.productId ? { productId: hints.productId } : {}),
          ...(hints.workItemId ? { workItemId: hints.workItemId } : {}),
          ...(hints.channelCode && ["NAVER", "COUPANG", "CAFE24"].includes(hints.channelCode)
            ? { channelCode: hints.channelCode as StartTurnRequest["channelCode"] }
            : {}),
          ...(hints.surface ? { surface: hints.surface } : {}),
        },
        trimmed,
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

  const newConversation = useCallback(() => {
    idRef.current = null;
    setConversationId(null);
    writeCurrent(null);
    setTurns([]);
    setPending(null);
    setWorkingSet(null);
    setError(null);
  }, []);

  const loadHistory = useCallback((limit = 10) => conversationClient.listConversations(limit), []);

  const openConversation = useCallback(
    async (id: string) => {
      const view = await conversationClient.getConversation(id);
      idRef.current = view.conversationId;
      adopt(view);
      setError(null);
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
    const timer = window.setInterval(() => {
      if (stopped) return;
      if (Date.now() - started > POLL_LIMIT) {
        window.clearInterval(timer);
        return;
      }
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void api
        .getSyncRunsStrict({ sellerAccountId: accountId, dataType })
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
      plannerOff,
      send,
      resume,
      newConversation,
      loadHistory,
      openConversation,
      addLocalTurn,
    }),
    [conversationId, turns, busy, elapsed, stages, error, pendingHumanAction, workingSet, plannerOff, send, resume, newConversation, loadHistory, openConversation, addLocalTurn],
  );
  return <ConversationContext.Provider value={value}>{children}</ConversationContext.Provider>;
}

/** Null outside the app shell (tests render pages bare); callers render nothing conversational then. */
export function useConversation(): ConversationState | null {
  return useContext(ConversationContext);
}
