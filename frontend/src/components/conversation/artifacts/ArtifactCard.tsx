import type { ReactNode } from "react";

/**
 * The container every artifact shares — and in the conversation, **most objects have no container
 * at all** (Reviewnary Visual System v1 §1, §3).
 *
 * Before this, a review list, a step that hands the seller to the seller center, a chart and a draft
 * were the identical white rounded card with the identical border and shadow, stacked on grey. One
 * radius for everything is one radius for nothing: the box said "this is a thing" about content that
 * was already obviously a thing, and said nothing about which of them the seller had to touch.
 *
 * So containment carries information now:
 *
 * - **A list, a table, a chart, a metric** is *set into* the page — a hairline above, a hairline
 *   below, rows that breathe. It reads like a table in a report, which is what it is.
 * - **`framed`** is reserved for the surfaces that ask for the seller's hand: a step out to the
 *   marketplace, an approval, a guided run, a knowledge question, a draft they are about to send.
 *   Those get a real edge, because an edge is now a signal rather than wallpaper.
 *
 * Everything else is unchanged: title (`sm`, 600) · optional action at the right of the header ·
 * optional one-line note · body, with the action always in the same place so a seller finds the
 * control of any object where they found the last one.
 */
export function ArtifactCard({ title, note, children, action, testId, headline, titleSaid, framed = false }: {
  title: string; note?: string | null; children?: ReactNode; action?: ReactNode; testId?: string;
  /**
   * The producer's own declaration that the sentence above already said this title (Agent Object +
   * First-use Closure v1 §3). It DECIDES when present: the writer of both sentences knows a
   * near-repeat («가장 오래 기다린 것부터 …» over 「가장 오래 기다린 문의」) that no containment test can
   * see, and knows an accidental substring that is not a repeat at all. `headline` containment stays
   * as the fallback for producers that have not declared — there the two strings are literally equal.
   */
  titleSaid?: boolean;
  /**
   * The sentence the agent said above this card. When it already contains the card's title, the
   * header is not drawn (Agentic Experience v2 §6): 「답변 안 한 문의는 12건입니다.」 with 「답변 안 한
   * 문의」 printed again two lines below is one fact wearing two type sizes. The title stays the
   * section's accessible name either way — what is dropped is the second RENDERING, never the fact.
   */
  headline?: string;
  /** This object asks for the seller's hand, so it gets an edge. Reading objects never do (§3). */
  framed?: boolean;
}) {
  const said = titleSaid ?? Boolean(headline && title && headline.includes(title));
  // ONE header row (Frontend-first Agent Workspace Redesign v1). The note used to be a row of its own
  // under an otherwise empty header, so a card whose title was already said still opened with a lone
  // button floating over a blank line and then the meta beneath it — three rows of chrome before the
  // draft. Title (when it is not a repeat) and note share the left; the action keeps its one place.
  const head = !said || note || action;
  return (
    <section
      aria-label={title}
      data-testid={testId}
      data-framed={framed ? "true" : undefined}
      className={framed ? "overflow-hidden rounded-xl border border-line bg-canvas/50" : ""}
    >
      {head ? (
        <header className={`flex items-start justify-between gap-3 ${framed ? "px-4 pt-3" : "pb-1.5"}`}>
          <div className="min-w-0">
            {/* A set-in block's title is a CAPTION for the rows under it, so it steps down and back:
                the rows carry the seller's own objects in ink, and a label above them in the same
                weight competes with what it is labelling. A framed card's title is the card. */}
            {said ? null : <h3 className={`break-keep text-sm font-semibold ${framed ? "text-ink" : "text-muted"}`}>{title}</h3>}
            {note ? <p className="break-keep text-sm text-muted">{note}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
      ) : null}
      {/* The rules ARE the object: they start under the header and close under the last row, so the
          block reads as one set-in table however many kinds of row it holds. It is pulled 16px wider
          than the column so the rows' own padding lands their text exactly on the prose above —
          objects set into a document line up with the sentence that introduces them. A framed card
          keeps its own edge and needs neither. */}
      <div className={framed ? "pb-3" : "-mx-4 border-y border-line"}>{children}</div>
    </section>
  );
}
