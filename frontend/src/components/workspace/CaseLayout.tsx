import { createContext, useContext, type ReactNode } from "react";

/**
 * <b>CaseLayout — one shape for every screen where the seller decides one thing</b> (UI/UX v2 Phase 1).
 *
 * <p>Inquiry Case, Review Case and a repeated problem used to be three layouts with three orders: one opened on the
 * customer's sentence, one on a product name, one on a lifecycle chip. They are now the same five parts in the same
 * order, because the seller asks the same questions of all three:
 *
 * <ol>
 *   <li><b>무엇인가</b> — a meta line (where it came from, how long it has waited) and the title;</li>
 *   <li><b>고객이 뭐라고 했나</b> — the subject, the largest body text on the screen;</li>
 *   <li><b>내가 할 일</b> — the decision: the one place a primary action may stand;</li>
 *   <li><b>무엇을 확인했나</b> — what Reviewnary checked and found;</li>
 *   <li><b>더 보기</b> — records and background, folded by the caller.</li>
 * </ol>
 *
 * <p><b>Two variants, same parts.</b> On a full page the decision stands in its own column beside the story and
 * follows the scroll. In the master-detail pane there is room for one column, so the decision comes straight after
 * what the customer wrote — never under the evidence, below the fold.
 *
 * <p>The layout owns placement and nothing else: every read, write and word belongs to the screen that composes it.
 */
export type CaseVariant = "page" | "pane";

const VariantContext = createContext<CaseVariant>("page");

export function useCaseVariant(): CaseVariant {
  return useContext(VariantContext);
}

export function CaseLayout({
  variant,
  nav,
  meta,
  title,
  headerAction,
  summary,
  subject,
  decision,
  decisionLabel,
  context,
  more,
  notice,
  titleHidden = false,
  sub,
  label = "선택한 항목",
}: {
  variant: CaseVariant;
  /** Breadcrumb or back link. */
  nav?: ReactNode;
  /** One muted line: source · product · wait. */
  meta?: ReactNode;
  title: ReactNode;
  /** A quiet link beside the title — 원문 보기, 전체 화면으로. Never a primary action. */
  headerAction?: ReactNode;
  /** What Reviewnary did vs what is the seller's, when the screen has one. */
  summary?: ReactNode;
  subject?: ReactNode;
  decision?: ReactNode;
  decisionLabel: string;
  context?: ReactNode;
  more?: ReactNode;
  /** An error or status line the whole case shares. */
  notice?: ReactNode;
  /**
   * Keep the heading for assistive technology but do not draw it — for a subject whose own panel already prints the
   * customer's words as its first line (the inquiry response panel), where a drawn title would be the same sentence
   * twice.
   */
  titleHidden?: boolean;
  /** One muted line under the title — the product the case is about. Its own line, so a long name never breaks the
   * meta line above into dangling separators. */
  sub?: ReactNode;
  /** The pane's accessible name. */
  label?: string;
}) {
  const pane = variant === "pane";
  const Heading = pane ? "h2" : "h1";

  const header = (
    <header className="flex flex-wrap items-start gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1">
        {meta ? <div className="mb-1.5 text-sm text-muted">{meta}</div> : null}
        <Heading
          className={
            titleHidden
              ? "sr-only"
              : `break-keep font-extrabold leading-snug tracking-tight text-ink [overflow-wrap:anywhere] ${
                  pane ? "text-xl" : "text-[24px] leading-tight"
                }`
          }
        >
          {title}
        </Heading>
        {sub ? <p className="mt-1 break-keep text-sm text-muted">{sub}</p> : null}
      </div>
      {headerAction ? <div className="shrink-0 pt-1 text-sm">{headerAction}</div> : null}
    </header>
  );

  const decisionBlock = decision ? (
    <section aria-label={decisionLabel} className={`flex flex-col ${pane ? "gap-3" : "gap-3.5"}`}>
      {decision}
    </section>
  ) : null;

  return (
    <VariantContext.Provider value={variant}>
      {pane ? (
        <article aria-label={label} className="space-y-4" data-case-variant="pane">
          {nav}
          {header}
          {summary}
          {notice}
          {subject}
          {decisionBlock}
          {context}
          {more}
        </article>
      ) : (
        <div className="mx-auto w-full max-w-[1080px] space-y-5" data-case-variant="page">
          {nav}
          {header}
          {summary}
          {notice}
          {/* Extra height goes to the last row, so a tall decision column never opens a gap under a short story. */}
          <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_380px] xl:grid-rows-[auto_auto_1fr] xl:gap-x-6">
            {subject ? <div className="min-w-0 space-y-3.5 xl:col-start-1">{subject}</div> : null}
            {decisionBlock ? (
              <div className="self-start xl:sticky xl:top-4 xl:col-start-2 xl:row-span-3 xl:row-start-1">{decisionBlock}</div>
            ) : null}
            {context ? <div className="min-w-0 space-y-3.5 self-start xl:col-start-1">{context}</div> : null}
            {more ? <div className="min-w-0 space-y-3.5 self-start xl:col-start-1">{more}</div> : null}
          </div>
        </div>
      )}
    </VariantContext.Provider>
  );
}

/**
 * One block of a case. On a page it is a card; inside the pane — which is already the surface — it is a section
 * under a hairline, because a card inside a panel inside a page is three borders saying one thing.
 */
export function CaseBlock({
  title,
  children,
  tone = "plain",
}: {
  title?: string;
  children: ReactNode;
  /** `subject` gives the customer's own words the reading size; everything else is plain. */
  tone?: "plain" | "subject";
}) {
  const variant = useCaseVariant();
  const H = variant === "pane" ? "h3" : "h2";
  const heading = title ? <H className="mb-2.5 text-sm font-bold text-muted">{title}</H> : null;
  if (variant === "pane") {
    return (
      <section aria-label={title} className={tone === "subject" ? "" : "border-t border-line pt-4"}>
        {heading}
        {children}
      </section>
    );
  }
  return (
    <section aria-label={title} className="rounded-2xl border border-line bg-surface px-5 py-5 sm:px-6">
      {heading}
      {children}
    </section>
  );
}

/** The customer's own words — the largest body text on any case, on either variant. */
export function CaseQuote({ children }: { children: ReactNode }) {
  return (
    <p className="whitespace-pre-wrap break-keep text-[17px] font-medium leading-[1.8] text-ink [overflow-wrap:anywhere]">
      {children}
    </p>
  );
}

/**
 * One group of the seller's decision. The group that holds the next thing to press is outlined in the brand colour —
 * the only emphasis a case gives, so there is never more than one place that looks like the primary action.
 */
export function DecisionCard({ children, primary = false }: { children: ReactNode; primary?: boolean }) {
  return (
    <div
      className={`rounded-2xl bg-surface p-5 ${
        primary ? "shadow-[0_0_0_1.5px_#1B64DA,0_18px_36px_-22px_rgba(27,100,218,0.45)]" : "border border-line"
      }`}
    >
      {children}
    </div>
  );
}
