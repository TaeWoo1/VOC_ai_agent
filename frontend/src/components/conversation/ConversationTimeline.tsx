import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { LAYOUT, MESSAGE, SWAP } from "../../lib/motion";
import { ArtifactView } from "./ArtifactView";
import { ProgressView } from "./ProgressView";
import { EvidenceArtifact } from "./artifacts/EvidenceArtifact";
import { Disclosure } from "../ui/Disclosure";
import { BtnLink } from "../ui/Btn";
import { NavIcon } from "../icons/NavIcon";
import { useContinueInPanel } from "./useContinueInPanel";
import type { DisplayTurn } from "../../lib/conversation/ConversationProvider";
import type { ProgressStageEvent, SuggestedAction } from "../../lib/conversation/types";

/**
 * The turns, in order, at chat density (Chat UI v1). A seller turn is their own words, right-aligned
 * in a quiet bubble. An agent turn is one paragraph, then its artifacts as compact objects, then —
 * on the LATEST agent turn only — the suggested next sentences as chips, then 「확인한 자료」 folded:
 * evidence is read on purpose, never first (design contract §9). A stopped turn reads as the stop
 * it was, never as an answer.
 */
export function ConversationTimeline({
  turns,
  busy,
  stages,
  elapsed,
  error,
  compact = false,
  onPrompt,
  onResume,
  onCaptureDecision,
}: {
  turns: DisplayTurn[];
  busy: boolean;
  stages: ProgressStageEvent[];
  elapsed: number;
  error: string | null;
  compact?: boolean;
  onPrompt: (prompt: string) => void;
  onResume: (turnId: string) => void;
  /** Knowledge Capture v1: the candidate card's 「저장하고 계속」 / 「취소」. Absent ⇒ the card shows no controls. */
  onCaptureDecision?: (captureId: string, fingerprint: string, decision: "SAVE" | "CANCEL") => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [turns.length, busy]);
  const lastAgent = [...turns].reverse().find((t) => t.role === "AGENT")?.turnId ?? null;

  // A thread that is already there (a reload, an opened conversation) is not re-played: `initial={false}`
  // means only turns that ARRIVE animate. Layout is animated so a turn that appears or a progress row that
  // leaves moves its neighbours instead of teleporting them.
  return (
    <div className={compact ? "space-y-4" : "space-y-5"} aria-label="대화" role="log">
      <AnimatePresence initial={false}>
        {turns.map((turn) => (
          <motion.div key={turn.turnId} layout="position" variants={MESSAGE} initial="hidden" animate="shown" transition={LAYOUT}>
            {turn.role === "USER" ? (
              <UserTurn text={turn.text ?? ""} />
            ) : (
              <AgentTurn
                turn={turn}
                compact={compact}
                latest={turn.turnId === lastAgent && !busy}
                onPrompt={onPrompt}
                onResume={() => onResume(turn.turnId)}
                onCaptureDecision={onCaptureDecision}
              />
            )}
          </motion.div>
        ))}
        {busy ? (
          <motion.div key="progress" layout="position" variants={MESSAGE} initial="hidden" animate="shown" exit="gone" transition={LAYOUT}>
            <ProgressView stages={stages} elapsed={elapsed} />
          </motion.div>
        ) : null}
        {error ? (
          <motion.p key="error" variants={MESSAGE} initial="hidden" animate="shown" exit="gone" className="break-keep rounded-xl border border-line bg-canvas px-4 py-2.5 text-sm text-bad" role="alert">{error}</motion.p>
        ) : null}
      </AnimatePresence>
      <div ref={endRef} />
    </div>
  );
}

function UserTurn({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[80%] whitespace-pre-wrap break-keep rounded-2xl rounded-br-md bg-brand-50 px-4 py-2 text-base leading-relaxed text-ink" data-testid="user-turn">
        {text}
      </p>
    </div>
  );
}

/**
 * An evidence row worth reading names something: a source with a count, a window, or a document title.
 * A bare generic label with nothing beside it is noise (§5) — it renders as an empty-looking bullet.
 */
function meaningfulEvidence(e: Extract<DisplayTurn["artifacts"][number], { type: "EVIDENCE" }>) {
  const items = e.items.filter((i) => i.label && (i.count != null || i.from != null || i.asOf != null || i.label !== "자료"));
  return items.length > 0 ? { ...e, items } : null;
}

function AgentTurn({ turn, compact, latest, onPrompt, onResume, onCaptureDecision }: {
  turn: DisplayTurn; compact: boolean; latest: boolean; onPrompt: (p: string) => void; onResume: () => void;
  onCaptureDecision?: (captureId: string, fingerprint: string, decision: "SAVE" | "CANCEL") => void;
}) {
  const evidence = turn.artifacts
    .filter((a): a is Extract<DisplayTurn["artifacts"][number], { type: "EVIDENCE" }> => a.type === "EVIDENCE")
    .map(meaningfulEvidence)
    .filter((a): a is NonNullable<ReturnType<typeof meaningfulEvidence>> => a != null);
  const shown = turn.artifacts.filter((a) => a.type !== "EVIDENCE");
  const failed = turn.status === "FAILED";
  const stopped = failed && turn.failureCode === "CANCELLED";
  // A failed turn reads as its own sentence (the runtime's closed seller wording — Response Hygiene v1),
  // never as a mechanism headline (「계획을 세우지 못했습니다」) with the sentence repeated under it.
  const headline = turn.message || turn.failureReason || "요청을 처리하지 못했습니다.";
  const detail = failed && !stopped && turn.failureReason && turn.failureReason !== turn.message ? turn.failureReason : null;
  return (
    <article className="group space-y-2.5" aria-label="AI 담당자" data-testid="agent-turn" data-status={turn.status}>
      <div className="flex items-start gap-2">
        <span aria-hidden="true" className={`mt-1 ${stopped ? "text-muted" : "text-brand-700"}`}>✳︎</span>
        <div className="min-w-0 flex-1">
          <p className={`whitespace-pre-wrap break-keep leading-relaxed ${stopped ? "text-muted" : "text-ink"} ${compact ? "text-base" : "text-[17px]"}`}>
            {headline}
          </p>
          {detail ? <p className="mt-1 break-keep text-sm text-muted">{detail}</p> : null}
        </div>
        {!stopped && turn.message ? <CopyButton text={turn.message} /> : null}
      </div>
      {shown.length > 0 ? (
        <div className={`space-y-2.5 ${compact ? "" : "pl-6"}`}>
          {/* Artifacts animate their own layout: a card that grows (a guided run engaged, a disclosure
              opened) or is replaced glides; the ones around it follow. */}
          <AnimatePresence initial={false}>
            {shown.map((artifact) => (
              <motion.div key={artifact.artifactId} layout variants={MESSAGE} initial="hidden" animate="shown" exit="gone" transition={LAYOUT} data-artifact={artifact.type}>
                <ArtifactView artifact={artifact} onResume={onResume} onPrompt={onPrompt} onCaptureDecision={latest ? onCaptureDecision : undefined} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      ) : null}
      <AnimatePresence initial={false}>
        {latest && turn.suggestedActions.length > 0 ? (
          <motion.div key="suggestions" layout="position" variants={MESSAGE} initial="hidden" animate="shown" exit="gone" transition={LAYOUT}>
            <Suggestions actions={turn.suggestedActions} compact={compact} onPrompt={onPrompt} onResume={onResume} />
          </motion.div>
        ) : null}
      </AnimatePresence>
      {evidence.length > 0 ? (
        <div className={compact ? "" : "pl-6"}>
          {/* No count beside 「근거」: the number was the count of rows read, which a seller reads as the
              strength of the answer. The disclosure is opened on purpose; what is inside says how much. */}
          <Disclosure label="근거" summaryClassName="px-0">
            <div className="mt-1 space-y-2">
              {evidence.map((e) => <EvidenceArtifact key={e.artifactId} artifact={e} />)}
            </div>
          </Disclosure>
        </div>
      ) : null}
    </article>
  );
}

/** Copies the agent's sentence. Says 「복사됨」 only after the clipboard accepted it — never before. */
function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard?.writeText(text);
      setDone(true);
      window.setTimeout(() => setDone(false), 1500);
    } catch {
      setDone(false);
    }
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={done ? "복사됨" : "복사"}
      title="복사"
      className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted opacity-0 transition hover:bg-canvas hover:text-ink focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 group-hover:opacity-100"
    >
      <AnimatePresence initial={false} mode="wait">
        <motion.span key={done ? "check" : "copy"} variants={SWAP} initial="hidden" animate="shown" exit="gone" className={`inline-flex ${done ? "text-good" : ""}`}>
          <NavIcon name={done ? "check" : "copy"} className="h-4 w-4" />
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

function Suggestions({ actions, compact, onPrompt, onResume }: { actions: SuggestedAction[]; compact: boolean; onPrompt: (p: string) => void; onResume: () => void }) {
  const onOpen = useContinueInPanel();
  return (
    <div className={`flex flex-wrap gap-1.5 ${compact ? "" : "pl-6"}`} aria-label="다음으로 할 수 있는 것">
      {actions.map((a) =>
        a.kind === "LINK" && a.to ? (
          <BtnLink key={a.label} to={a.to} variant="outline" size="sm" onClick={onOpen}>{a.label}</BtnLink>
        ) : (
          <button
            key={a.label}
            type="button"
            onClick={() => (a.kind === "RESUME" ? onResume() : onPrompt(a.prompt ?? a.label))}
            className="min-h-[32px] rounded-full border border-line bg-surface px-3 text-sm font-medium text-muted transition hover:border-brand/40 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
          >
            {a.label}
          </button>
        ),
      )}
    </div>
  );
}
