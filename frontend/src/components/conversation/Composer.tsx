import { useEffect, useRef, useState, type ReactNode } from "react";
import { Btn } from "../ui/Btn";
import { asksToSend, SEND_FENCE_COPY } from "../../lib/agentSendFence";

/**
 * The one box (docs/reviewnary_design.md §8-A). Enter sends, Shift+Enter breaks a line; the approval
 * boundary is printed under a sentence that asks to send BEFORE the wait. The box never dispatches on
 * its own — a launcher lands nothing here, and a chip is a sentence the seller still has to send.
 */
export function Composer({
  onSend,
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

  const blocked = busy || disabled;
  function submit(sentence: string) {
    const trimmed = sentence.trim();
    if (!trimmed || blocked) return;
    onSend(trimmed);
    setText("");
  }
  const sendAsked = asksToSend(text);

  return (
    <form
      aria-label="AI 담당자에게 요청"
      onSubmit={(e) => {
        e.preventDefault();
        submit(text);
      }}
      className="space-y-2"
    >
      <div className={`flex gap-2 rounded-2xl border border-line bg-surface focus-within:border-brand-700 ${compact ? "p-1.5" : "p-2"}`}>
        <span aria-hidden="true" className="flex items-start pl-2 pt-2 text-brand-700">✳︎</span>
        <label htmlFor={inputId} className="sr-only">
          무엇이든 물어보세요
        </label>
        <textarea
          id={inputId}
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={compact ? 2 : 2}
          disabled={disabled}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit(text);
            }
          }}
          className="min-h-[40px] min-w-0 flex-1 resize-none bg-transparent py-2 text-base text-ink placeholder:text-muted focus:outline-none disabled:opacity-50"
        />
        <div className="flex items-end">
          <Btn type="submit" size={compact ? "sm" : "md"} disabled={blocked || !text.trim()}>
            {busy ? "확인 중…" : "보내기"}
          </Btn>
        </div>
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
