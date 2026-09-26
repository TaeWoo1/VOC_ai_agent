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
 *   <li><b>무엇을 확인했나</b> — what Reviewnary checked and found;</li>
 *   <li><b>내가 할 일</b> — the decision: the one place a primary action may stand;</li>
 *   <li><b>더 보기</b> — records and background, folded by the caller.</li>
 * </ol>
 *
 * <p><b>Two variants, same parts.</b> On a full page the decision stands in its own column beside the story and
 * follows the scroll. In the master-detail pane there is room for one column, and the order above is the order
 * it draws.
 *
 * <p><b>The pane used to put the decision straight after the customer's words</b> — 「never under the evidence,
 * below the fold」 — and that rule is retired (Review Decision UX v3.2, product-owner decision). It was written
 * to keep the decision on the first screen, and measurement showed it had stopped doing that: on 확인할 일 at
 * 1440×900 the decision block is <b>995px</b> tall, so 반복 신호 landed at y=1,191 and 이 상품에 대해 아는 것
 * at y=1,498 — the seller was asked to judge at y=201 and shown what was found a screen and a half below.
 * The rule bought nothing it promised and cost the thing it was protecting. The order is now
 * <b>고객 요청 → 확인한 사실 → 판매자 판단 → primary action</b>, and the promise it replaces is kept by
 * measurement instead: the primary action must stand inside the fold at 1440×900, 1366×768 and 1152×720.
 *
 * <p>The layout owns placement and nothing else: every read, write and word belongs to the screen that composes it.
 */
export type CaseVariant = "page" | "pane";

const VariantContext = createContext<CaseVariant>("page");

export function useCaseVariant(): CaseVariant {
  return useContext(VariantContext);
}

/**
 * <b>How deep the pane goes</b> (Home v3.1).
 *
 * <p>A pane can be the workspace — every control the page has, in one column — or a <b>preview</b>: what
 * this is, why it was brought up, what was checked, what is recommended, and one way in. The second
 * reading exists because the morning screen's subject is the list: a 440px column that unfolds two
 * segmented judgments and a record control is not a preview of the work, it is a second copy of the
 * workspace competing with the list for the eye.
 *
 * <p><b>It hides forms, never facts.</b> Everything a preview leaves out stands one press away on the
 * full case, which is unchanged, and no state, endpoint or write differs between the two readings.
 */
export type PaneDepth = "full" | "preview";

const DepthContext = createContext<PaneDepth>("full");

export function usePaneDepth(): PaneDepth {
  return useContext(DepthContext);
}

export function CaseLayout({
  variant,
  depth = "full",
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
  /** {@link PaneDepth}. Only read in the pane — a page is never a preview. */
  depth?: PaneDepth;
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
  const storyEmpty = !subject && !context && !more;

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
    <section aria-label={decisionLabel} className="flex flex-col gap-3">
      {decision}
    </section>
  ) : null;

  return (
    <VariantContext.Provider value={variant}>
      <DepthContext.Provider value={pane ? depth : "full"}>
      {pane ? (
        <article
          aria-label={label}
          // A preview separates its groups with air and nothing else, so the air has to be enough to do the job
          // a rule used to do. Measured at 20px the gap between 고객 원문 and 확인 필요 (41px) and the gap between
          // 확인 필요 and 근거 (44px) were the same distance, so the reader had no grouping at all; at 28px the
          // between-group air is four times the within-group air and the three questions read as three.
          className={depth === "preview" ? "space-y-7" : "space-y-4"}
          data-case-variant="pane"
          data-pane-depth={depth}
        >
          {nav}
          {header}
          {summary}
          {notice}
          {subject}
          {/* 고객 요청 → 확인한 사실 → 판매자 판단 → primary action — at BOTH depths. See the docblock: the
              rule this replaces put the decision first and the measurement retired it. */}
          {context}
          {decisionBlock}
          {more}
        </article>
      ) : (
        <div className="mx-auto w-full max-w-[1080px] space-y-4" data-case-variant="page">
          {nav}
          {header}
          {/* The strip follows the body's width. With one column it was a 1,500px band over a 560px card —
              the page reading as two different documents stacked. */}
          {summary ? <div className={storyEmpty ? "max-w-[560px]" : undefined}>{summary}</div> : null}
          {notice}
          {/* <b>Two columns only when there are two columns' worth</b> (Review Decision UX v3.2). A case
              whose question is its own title, whose checks are empty and whose evidence the draft already
              cites has nothing for the left track — and the grid still reserved it, so the page ran 660px
              of white beside a 360px card. Callers pass null for a block that would render nothing, which
              is what makes this answerable here at all. */}
          {/* Extra height goes to the last row, so a tall decision column never opens a gap under a short story. */}
          <div
            className={`grid gap-3 ${
              storyEmpty ? "max-w-[560px]" : "lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto_auto_1fr] lg:gap-x-6"
            }`}
          >
            {subject ? <div className="min-w-0 space-y-3 lg:col-start-1">{subject}</div> : null}
            {decisionBlock ? (
              <div className="self-start lg:sticky lg:top-4 lg:col-start-2 lg:row-span-3 lg:row-start-1">{decisionBlock}</div>
            ) : null}
            {context ? <div className="min-w-0 space-y-3.5 self-start lg:col-start-1">{context}</div> : null}
            {more ? <div className="min-w-0 space-y-3.5 self-start lg:col-start-1">{more}</div> : null}
          </div>
        </div>
      )}
      </DepthContext.Provider>
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
  flat = false,
}: {
  title?: string;
  children: ReactNode;
  /** `subject` gives the customer's own words the reading size; everything else is plain. */
  tone?: "plain" | "subject";
  /**
   * A hairline section on the page too, not only in the pane (Review Decision UX v3.2).
   *
   * <p>For a block whose whole content is a line or three — 「왜 올라왔나요」 measured 220px of card for
   * three short lines, and it was the first thing under the customer's sentence. A card says 「separate
   * object」, and a near-empty card says it loudest about the thing with least in it.
   */
  flat?: boolean;
}) {
  const variant = useCaseVariant();
  const H = variant === "pane" ? "h3" : "h2";
  const heading = title ? <H className="mb-2.5 text-sm font-bold text-muted">{title}</H> : null;
  if (variant === "pane" || flat) {
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

/**
 * <b>The quietest possible name for a group of facts.</b>
 *
 * <p>Studied against Linear's Peek preview: the card has <b>no headings and no rules</b> — an identifier, a
 * title, metadata flowing as chips, a paragraph, a footnote. A 440px preview that answers three questions does
 * need to say which is which, but a bold heading over a hairline is the weight a page section earns, not a
 * group of two lines. Twelve pixels, muted, no rule, and the group below it separated by air.
 *
 * <p>The region keeps its real accessible name from the `Section` that wraps it, so nothing is lost to a screen
 * reader by the heading not being drawn.
 */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-[12px] font-medium leading-none text-muted">{children}</p>;
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
  // Less padding inside a pane: the card is already inside a 556px panel inside the page, and every
  // millimetre of its inset is one the primary action pays for on the one screen it has.
  const pad = useCaseVariant() === "pane" ? "p-3" : "p-4";
  return (
    <div
      className={`rounded-2xl bg-surface ${pad} ${
        primary ? "shadow-[0_0_0_1.5px_#1B64DA,0_18px_36px_-22px_rgba(27,100,218,0.45)]" : "border border-line"
      }`}
    >
      {children}
    </div>
  );
}
