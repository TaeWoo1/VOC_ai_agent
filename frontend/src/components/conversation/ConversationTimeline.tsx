import { useEffect, useRef } from "react";
import { ArtifactView } from "./ArtifactView";
import { ProgressView } from "./ProgressView";
import { EvidenceArtifact } from "./artifacts/EvidenceArtifact";
import { Disclosure } from "../ui/Disclosure";
import { BtnLink } from "../ui/Btn";
import { useContinueInPanel } from "./useContinueInPanel";
import type { DisplayTurn } from "../../lib/conversation/ConversationProvider";
import type { ProgressStageEvent, SuggestedAction } from "../../lib/conversation/types";

/**
 * The turns, in order. A seller turn is their own words, right-aligned. An agent turn is one message
 * paragraph, then its artifacts as objects, then the suggested next sentences as chips, then
 * 「확인한 자료」 folded — evidence is read on purpose, never first (design contract §9).
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
}: {
  turns: DisplayTurn[];
  busy: boolean;
  stages: ProgressStageEvent[];
  elapsed: number;
  error: string | null;
  compact?: boolean;
  onPrompt: (prompt: string) => void;
  onResume: (turnId: string) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [turns.length, busy]);

  return (
    <div className={compact ? "space-y-3" : "space-y-4"} aria-label="대화" role="log">
      {turns.map((turn) =>
        turn.role === "USER" ? (
          <UserTurn key={turn.turnId} text={turn.text ?? ""} />
        ) : (
          <AgentTurn key={turn.turnId} turn={turn} compact={compact} onPrompt={onPrompt} onResume={() => onResume(turn.turnId)} />
        ),
      )}
      {busy ? <ProgressView stages={stages} elapsed={elapsed} /> : null}
      {error ? (
        <p className="break-keep rounded-2xl border border-line bg-canvas px-4 py-3 text-sm text-bad" role="alert">{error}</p>
      ) : null}
      <div ref={endRef} />
    </div>
  );
}

function UserTurn({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] whitespace-pre-wrap break-keep rounded-2xl rounded-br-md bg-brand-50 px-4 py-2 text-base text-ink" data-testid="user-turn">
        {text}
      </p>
    </div>
  );
}

function AgentTurn({ turn, compact, onPrompt, onResume }: { turn: DisplayTurn; compact: boolean; onPrompt: (p: string) => void; onResume: () => void }) {
  const evidence = turn.artifacts.filter((a) => a.type === "EVIDENCE");
  const shown = turn.artifacts.filter((a) => a.type !== "EVIDENCE");
  const failed = turn.status === "FAILED";
  return (
    <article className="space-y-3" aria-label="AI 담당자" data-testid="agent-turn" data-status={turn.status}>
      <div className="flex items-start gap-2">
        <span aria-hidden="true" className="mt-1 text-brand-700">✳︎</span>
        <div className="min-w-0 flex-1">
          <p className={`whitespace-pre-wrap break-keep text-ink ${compact ? "text-base" : "text-lg leading-relaxed"} ${failed ? "font-semibold" : ""}`}>
            {failed ? "이 요청은 계획을 세우지 못했습니다" : turn.message}
          </p>
          {failed && (turn.failureReason || turn.message) ? (
            <p className="mt-1 break-keep text-sm text-muted">{turn.failureReason ?? turn.message}</p>
          ) : null}
        </div>
      </div>
      {shown.length > 0 ? (
        <div className={`space-y-3 ${compact ? "" : "pl-6"}`}>
          {shown.map((artifact) => (
            <div key={artifact.artifactId} data-artifact={artifact.type}>
              <ArtifactView artifact={artifact} onResume={onResume} />
            </div>
          ))}
        </div>
      ) : null}
      {turn.suggestedActions.length > 0 ? (
        <Suggestions actions={turn.suggestedActions} compact={compact} onPrompt={onPrompt} onResume={onResume} />
      ) : null}
      {evidence.length > 0 ? (
        <div className={compact ? "" : "pl-6"}>
          <Disclosure label="확인한 자료" note={evidence.reduce((n, e) => n + (e.type === "EVIDENCE" ? e.items.length : 0), 0) || undefined} summaryClassName="px-0">
            <div className="mt-1 space-y-2">
              {evidence.map((e) => (e.type === "EVIDENCE" ? <EvidenceArtifact key={e.artifactId} artifact={e} /> : null))}
            </div>
          </Disclosure>
        </div>
      ) : null}
    </article>
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
