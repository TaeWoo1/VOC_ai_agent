import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavIcon } from "../icons/NavIcon";
import { asksToSend, SEND_FENCE_COPY } from "../../lib/agentSendFence";

/**
 * The one box (docs/reviewnary_design.md §8-A), docked at the bottom of the transcript (Chat UI v1).
 *
 * Enter sends, Shift+Enter breaks a line; the box grows with the text up to ~8 lines and then scrolls.
 * ONE round control at the right edge: ArrowUp to send while idle, Stop while a turn is running — the
 * same place, so the seller's hand does not move. Stop is real: it closes the stream and the runtime
 * cancels the run's budget (`ConversationProvider.stop`) — the box never pretends. The approval
 * boundary is printed under a sentence that asks to send BEFORE the wait. The box never dispatches on
 * its own — a launcher lands nothing here, and a chip is a sentence the seller still has to send.
 */
export function Composer({
  onSend,
  onStop,
  busy,
  disabled = false,
  placeholder = "무엇이든 물어보세요",
  initialText = "",
  autoFocus = false,
  chips = [],
  footer,
  compact = false,
  inputId = "conversation-input",
}: {
  onSend: (text: string) => void;
  /** Present when the turn in flight can be stopped; absent ⇒ no Stop control is drawn. */
  onStop?: () => void;
  busy: boolean;
  disabled?: boolean;
  placeholder?: string;
  initialText?: string;
  autoFocus?: boolean;
  /** Example prompts. Pressing one puts the sentence in the box and sends it — it is the seller's press. */
  chips?: readonly string[];
  footer?: ReactNode;
  compact?: boolean;
  inputId?: string;
}) {
  const [text, setText] = useState(initialText);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText(initialText);
  }, [initialText]);

  useEffect(() => {
    if (autoFocus) window.setTimeout(() => ref.current?.focus(), 0);
  }, [autoFocus]);

  // Grow with the text (1 → ~8 lines), then scroll inside the box.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    const max = compact ? 160 : 200;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [text, compact]);

  const blocked = busy || disabled;
  function submit(sentence: string) {
    const trimmed = sentence.trim();
    if (!trimmed || blocked) return;
    onSend(trimmed);
    setText("");
  }
  const sendAsked = asksToSend(text);
  const canStop = busy && !!onStop;

  return (
    <form
      aria-label="AI 담당자에게 요청"
      onSubmit={(e) => {
        e.preventDefault();
        submit(text);
      }}
      className="space-y-2"
    >
      <div
        className={`flex items-end gap-2 rounded-2xl border border-line bg-surface shadow-sm transition focus-within:border-brand-700 focus-within:shadow-md ${compact ? "px-3 py-2" : "px-4 py-2.5"} ${disabled ? "opacity-60" : ""}`}
        data-state={canStop ? "running" : disabled ? "disabled" : "idle"}
      >
        <label htmlFor={inputId} className="sr-only">
          무엇이든 물어보세요
        </label>
        <textarea
          id={inputId}
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={1}
          disabled={disabled}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit(text);
            }
          }}
          className="min-h-[28px] min-w-0 flex-1 resize-none bg-transparent py-1 text-base leading-relaxed text-ink placeholder:text-muted focus:outline-none disabled:cursor-not-allowed"
        />
        {canStop ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="중지"
            title="중지"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-white transition hover:bg-ink/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
          >
            <NavIcon name="stop" className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="submit"
            aria-label="보내기"
            title="보내기 (Enter)"
            disabled={blocked || !text.trim()}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-700 text-white transition hover:bg-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 disabled:bg-line disabled:text-muted"
          >
            <NavIcon name="arrowUp" className="h-5 w-5" />
          </button>
        )}
      </div>
      {sendAsked ? (
        <p className="break-keep rounded-lg bg-canvas px-3 py-2 text-sm text-muted" data-testid="agent-send-fence">
          {SEND_FENCE_COPY}
        </p>
      ) : null}
      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" aria-label="예시 질문">
          {chips.map((chip) => (
            <button
              key={chip}
              type="button"
              disabled={blocked}
              onClick={() => submit(chip)}
              className="min-h-[32px] rounded-full border border-line bg-surface px-3 text-sm font-medium text-muted transition hover:border-brand/40 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 disabled:opacity-50"
            >
              {chip}
            </button>
          ))}
        </div>
      ) : null}
      {footer}
    </form>
  );
}
