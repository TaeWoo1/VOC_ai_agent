import type { ReactNode } from "react";

/**
 * The container every artifact shares: title (sm, 600) · optional action at the right of the header ·
 * optional one-line note · body. Compact inside a transcript (Chat UI v1): the header is one row, the
 * body rows carry their own padding, and the action always sits in the same place — top-right — so a
 * seller finds the control of any object where they found the last one. Never a card wall — one per object.
 */
export function ArtifactCard({ title, note, children, action, testId, headline }: {
  title: string; note?: string | null; children?: ReactNode; action?: ReactNode; testId?: string;
  /**
   * The sentence the agent said above this card. When it already contains the card's title, the
   * header is not drawn (Agentic Experience v2 §6): 「답변 안 한 문의는 12건입니다.」 with 「답변 안 한
   * 문의」 printed again two lines below is one fact wearing two type sizes. The title stays the
   * section's accessible name either way — what is dropped is the second RENDERING, never the fact.
   */
  headline?: string;
}) {
  const said = Boolean(headline && title && headline.includes(title));
  const header = !said || action;
  return (
    <section aria-label={title} data-testid={testId} className="overflow-hidden rounded-xl border border-line bg-surface">
      {header ? (
        <header className="flex items-center justify-between gap-3 px-4 pt-2.5">
          {said ? <span /> : <h3 className="min-w-0 break-keep text-sm font-semibold text-ink">{title}</h3>}
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
      ) : null}
      {note ? <p className="break-keep px-4 pt-0.5 text-sm text-muted">{note}</p> : null}
      <div className={`pb-1 ${header || note ? "pt-1.5" : "pt-1"}`}>{children}</div>
    </section>
  );
}
