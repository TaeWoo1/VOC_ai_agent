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
  dockKey = "",
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
  /**
   * Changes whenever the dock below grows or shrinks (Working Context v1 §1) — the context bar
   * appearing takes height the transcript was using, and without re-pinning the last turn ends up
   * behind it. It is a scroll trigger, not content.
   */
  dockKey?: string;
  onPrompt: (prompt: string) => void;
  onResume: (turnId: string) => void;
  /** Knowledge Capture v1: the candidate card's 「저장하고 계속」 / 「취소」. Absent ⇒ the card shows no controls. */
  onCaptureDecision?: (captureId: string, fingerprint: string, decision: "SAVE" | "CANCEL") => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [turns.length, busy, dockKey]);
  const lastAgent = [...turns].reverse().find((t) => t.role === "AGENT")?.turnId ?? null;
  const thread = threadChannel(turns);

  // A thread that is already there (a reload, an opened conversation) is not re-played: `initial={false}`
  // means only turns that ARRIVE animate. Layout is animated so a turn that appears or a progress row that
  // leaves moves its neighbours instead of teleporting them.
  return (
    // The rhythm is the reading order (Frontend-first Agent Workspace Redesign v1): turns are separated
    // by more space than anything INSIDE a turn, so a seller's eye finds the next answer before it finds
    // the next card. Reviewnary Visual System v1 §1 widens it to 32px: without card outlines around the
    // objects, WHITE SPACE is the only thing left saying where one answer ends and the next begins, and
    // 24px was not enough of it to read as a document.
    <div className={compact ? "space-y-6" : "space-y-8"} aria-label="대화" role="log">
      <AnimatePresence initial={false}>
        {turns.map((turn, i) => (
          <motion.div key={turn.turnId} layout="position" variants={MESSAGE} initial="hidden" animate="shown" transition={LAYOUT}>
            {turn.role === "USER" ? (
              <UserTurn text={turn.text ?? ""} />
            ) : (
              <AgentTurn
                turn={turn}
                threadChannel={thread}
                compact={compact}
                latest={turn.turnId === lastAgent && !busy}
                userText={precedingUserText(turns, i)}
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
          <motion.p key="error" variants={MESSAGE} initial="hidden" animate="shown" exit="gone" className="break-keep border-l-2 border-bad/40 pl-3 text-sm text-bad" role="alert">{error}</motion.p>
        ) : null}
      </AnimatePresence>
      <div ref={endRef} />
    </div>
  );
}

/**
 * **The channel this conversation is about, until the seller changes it.**
 *
 * Read backwards from the newest turn: the first channel any object in the thread names is the one the
 * seller is working in. Measured on the real Demo Org, 2026-09-02: a NAVER thread asked an ordinary
 * follow-up and the answer arrived with a Cafe24 freshness footer and a COUPANG step card beside it — three
 * marketplaces in a conversation about one. This does not change what was READ (scope belongs to the
 * planner); it decides which of the step cards a turn produced belongs on screen in THIS thread.
 */
function threadChannel(turns: readonly DisplayTurn[]): string | null {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    for (const artifact of turns[i]!.artifacts ?? []) {
      const code = "channelCode" in artifact ? (artifact as { channelCode?: string | null }).channelCode : null;
      if (code) return code.toUpperCase();
    }
  }
  return null;
}

/**
 * The step cards a turn may show: **one**, and the thread's own channel wins.
 *
 * A stale-channel card is a real fact, but three of them stacked under one answer is a status board, and
 * the seller asked a question. The turn keeps the card for the channel it is about; the others are dropped
 * from the transcript (the channel screen still holds every one of them).
 */
export function stepCardsFor<T extends { type: string; artifactId: string; channelCode?: string | null }>(
  artifacts: readonly T[],
  thread: string | null,
): readonly T[] {
  const steps = artifacts.filter((a) => a.type === "HUMAN_ACTION_REQUIRED");
  if (steps.length <= 1) return steps;
  const mine = thread ? steps.filter((a) => (a.channelCode ?? "").toUpperCase() === thread) : [];
  return [(mine[0] ?? steps[0])!];
}

/**
 * The seller's own words: the ONE bubble left in the transcript (§2). It is `canvas`, not a brand
 * tint — the accent is spent on things you press, and a chat needs exactly one signal for "this side
 * is you", which the alignment and the ground already give.
 */
function UserTurn({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[78%] whitespace-pre-wrap break-keep rounded-2xl rounded-br-md bg-canvas px-4 py-2.5 text-base leading-relaxed text-ink" data-testid="user-turn">
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

/** The sentence this agent turn is answering — read backwards, so a resumed turn keeps the original ask. */
export function precedingUserText(turns: readonly DisplayTurn[], index: number): string {
  for (let i = index - 1; i >= 0; i -= 1) {
    const t = turns[i]!;
    if (t.role === "USER") return t.text ?? "";
  }
  return "";
}

/** The operational domains a sentence NAMES. Closed nouns; two of them means the seller asked for two. */
const DOMAIN_WORDS: ReadonlyArray<readonly [string, string]> = [
  ["리뷰", "REVIEW"], ["후기", "REVIEW"],
  ["문의", "INQUIRY"], ["문의사항", "INQUIRY"],
  ["주문", "ORDER"], ["매출", "ORDER"],
  ["상품", "PRODUCT"],
];

export function domainsAsked(text: string): number {
  const lower = (text ?? "").toLowerCase();
  return new Set(DOMAIN_WORDS.filter(([w]) => lower.includes(w)).map(([, d]) => d)).size;
}

/** Which artifact types ARE an object collection — the things a turn can be two lists deep in. */
const COLLECTIONS = new Set(["INQUIRY_LIST", "REVIEW_LIST", "PRODUCT_LIST", "ISSUE_LIST", "LIST", "CHECKLIST"]);

/**
 * **One primary collection per turn, unless the seller asked for more than one** (§4).
 *
 * A turn that draws two lists asks the seller to read the second before they have finished the first, and
 * the sentence above them only answered one question. The first collection stays open; the rest fold to
 * their counts (one press restores them). A sentence that named two domains — 「리뷰랑 문의 둘 다」 — asked
 * for both, and nothing folds.
 */
export function secondaryCollections(
  artifacts: ReadonlyArray<{ type: string }>, domains: number,
): ReadonlySet<number> {
  if (domains > 1) return new Set();
  const out = new Set<number>();
  let seen = 0;
  artifacts.forEach((a, i) => {
    if (!COLLECTIONS.has(a.type)) return;
    seen += 1;
    if (seen > 1) out.add(i);
  });
  return out;
}

function AgentTurn({ turn, threadChannel: thread, compact, latest, userText, onPrompt, onResume, onCaptureDecision }: {
  turn: DisplayTurn; threadChannel: string | null; compact: boolean; latest: boolean; userText: string;
  onPrompt: (p: string) => void; onResume: () => void;
  onCaptureDecision?: (captureId: string, fingerprint: string, decision: "SAVE" | "CANCEL") => void;
}) {
  const evidence = turn.artifacts
    .filter((a): a is Extract<DisplayTurn["artifacts"][number], { type: "EVIDENCE" }> => a.type === "EVIDENCE")
    .map(meaningfulEvidence)
    .filter((a): a is NonNullable<ReturnType<typeof meaningfulEvidence>> => a != null);
  const keptSteps = new Set(stepCardsFor(turn.artifacts as ReadonlyArray<{ type: string; artifactId: string; channelCode?: string | null }>, thread).map((a) => a.artifactId));
  const shown = turn.artifacts.filter(
    (a) => a.type !== "EVIDENCE" && (a.type !== "HUMAN_ACTION_REQUIRED" || keptSteps.has(a.artifactId)),
  );
  // Which channels this turn already raised as a STEP. A list under a step card must not restate the
  // same channel's state in its own footer — the card says it, and it carries the control that fixes it.
  const stepped = shown
    .filter((a) => a.type === "HUMAN_ACTION_REQUIRED")
    .map((a) => (a.type === "HUMAN_ACTION_REQUIRED" ? a.channelCode : null))
    .filter((c): c is string => c != null);
  // **One control per thing to do.** A RESUME chip and a step card's 「계속 확인하기」 are the same press
  // 15 cm apart, and the seller has to work out which is real — observed on the live screen, where the two
  // sat one above the other. The card owns that control whenever it is on screen; the chip is what offers it
  // when nothing else does.
  const chips = shown.some((a) => a.type === "HUMAN_ACTION_REQUIRED")
    ? turn.suggestedActions.filter((a) => a.kind !== "RESUME")
    : turn.suggestedActions;
  const failed = turn.status === "FAILED";
  const stopped = failed && turn.failureCode === "CANCELLED";
  // A failed turn reads as its own sentence (the runtime's closed seller wording — Response Hygiene v1),
  // never as a mechanism headline (「계획을 세우지 못했습니다」) with the sentence repeated under it.
  const headline = turn.message || turn.failureReason || "요청을 처리하지 못했습니다.";
  const detail = failed && !stopped && turn.failureReason && turn.failureReason !== turn.message ? turn.failureReason : null;
  return (
    // <b>No nameplate.</b> The ✳︎ that opened every agent turn was a label saying who was speaking,
    // in a two-party conversation where the alignment already says it — and the 24px indent it
    // forced pushed every object list one step off the reading edge. It survives in exactly the two
    // places where it carries information rather than identity: the running progress line, and a
    // turn that STOPPED (Reviewnary Visual System v1 §2). A failed turn keeps a rule, because "this
    // did not happen" is not something to infer from a colour alone.
    <article
      className={`group space-y-3 ${failed ? "border-l-2 border-line pl-3" : ""}`}
      aria-label="AI 담당자"
      data-testid="agent-turn"
      data-status={turn.status}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {/* The answer is the assistant's own voice and it gets its own type step (`prose`, 17/1.75)
              — the largest text in an ordinary turn, above the objects it is about. What the seller
              OPENS (a customer's message, a draft) still steps up past it, because that is the thing
              they came to read. */}
          <p className={`whitespace-pre-wrap break-keep ${compact ? "text-base leading-relaxed" : "text-prose"} ${stopped ? "text-muted" : "text-ink"}`}>
            {headline}
          </p>
          {detail ? <p className="mt-1 break-keep text-sm text-muted">{detail}</p> : null}
        </div>
        {!stopped && turn.message ? <CopyButton text={turn.message} /> : null}
      </div>
      {shown.length > 0 ? (
        <div className="space-y-3">
          {/* Artifacts animate their own layout: a card that grows (a guided run engaged, a disclosure
              opened) or is replaced glides; the ones around it follow. */}
          <AnimatePresence initial={false}>
            {shown.map((artifact, i) => (
              <motion.div key={artifact.artifactId} layout variants={MESSAGE} initial="hidden" animate="shown" exit="gone" transition={LAYOUT} data-artifact={artifact.type}>
                <ArtifactView
                  artifact={artifact} onResume={onResume} onPrompt={onPrompt}
                  onCaptureDecision={latest ? onCaptureDecision : undefined}
                  stepped={stepped} headline={headline} latest={latest}
                  secondary={secondaryCollections(shown, domainsAsked(userText)).has(i)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      ) : null}
      {/* The run's LIMITS, apart from its answer (Agentic Experience v2). What the agent could not see
          is a real fact and it is said — but it is not the answer, and welding it to the answer's
          paragraph is how 「낮은 평점 리뷰는 8건입니다」 arrived inside a four-line block about failed
          collection. One quiet line per limit, under the objects the answer is about. */}
      {turn.notes && turn.notes.length > 0 ? (
        <ul className="space-y-0.5" aria-label="확인하지 못한 것">
          {turn.notes.map((note, i) => (
            <li key={i} className="break-keep text-sm leading-snug text-muted">{note}</li>
          ))}
        </ul>
      ) : null}
      <AnimatePresence initial={false}>
        {latest && chips.length > 0 ? (
          <motion.div key="suggestions" layout="position" variants={MESSAGE} initial="hidden" animate="shown" exit="gone" transition={LAYOUT}>
            <Suggestions actions={chips} onPrompt={onPrompt} onResume={onResume} />
          </motion.div>
        ) : null}
      </AnimatePresence>
      {evidence.length > 0 ? (
        <div>
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

function Suggestions({ actions, onPrompt, onResume }: { actions: SuggestedAction[]; onPrompt: (p: string) => void; onResume: () => void }) {
  const onOpen = useContinueInPanel();
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="다음으로 할 수 있는 것">
      {actions.map((a) =>
        a.kind === "LINK" && a.to ? (
          <BtnLink key={a.label} to={a.to} variant="outline" size="sm" onClick={onOpen}>{a.label}</BtnLink>
        ) : (
          <button
            key={a.label}
            type="button"
            onClick={() => (a.kind === "RESUME" ? onResume() : onPrompt(a.prompt ?? a.label))}
            className="min-h-[32px] rounded-lg bg-canvas px-3 text-sm font-medium text-muted transition hover:bg-line/60 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
          >
            {a.label}
          </button>
        ),
      )}
    </div>
  );
}
