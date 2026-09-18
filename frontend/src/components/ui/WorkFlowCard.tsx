import type { ReactNode } from "react";

/**
 * <b>「자동 확인 → 내 확인 필요」</b> — the two cells every customer-operations screen opens with (v3.1).
 *
 * The left cell is what was already done without the seller; the right cell is what is left for them, tinted so it is
 * the one the eye lands on second and stays on. `warnings` are the lines that qualify the left cell's number — a
 * source that could not be read — and they render under both cells only when there is one.
 */
export interface FlowCell {
  label: string;
  /** The large figure or phrase. */
  value: ReactNode;
  /** The unit or qualifier beside it, smaller. */
  unit?: ReactNode;
  /** One line under the figure. */
  line?: ReactNode;
  /** A control under the line. */
  action?: ReactNode;
  /** A phrase rather than a number — set smaller so a sentence does not shout. */
  phrase?: boolean;
}

export function WorkFlowCard({
  done,
  mine,
  warnings = [],
  ariaLabel,
}: {
  done: FlowCell;
  mine: FlowCell;
  warnings?: ReactNode[];
  ariaLabel?: string;
}) {
  const hasFoot = warnings.length > 0;
  return (
    <section
      aria-label={ariaLabel ?? `${done.label}, ${mine.label}`}
      className="overflow-hidden rounded-[16px] bg-surface shadow-[0_0_0_1px_#E4E7EC,0_8px_24px_-18px_rgba(15,25,45,0.35)]"
      data-testid="work-flow-card"
    >
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_36px_minmax(0,1fr)]">
        <Cell cell={done} icon={<CheckIcon />} />
        <div aria-hidden="true" className="hidden items-center justify-center sm:flex">
          <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-none stroke-[#B0B8C1] stroke-2">
            <path d="M5 12h14 M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <Cell cell={mine} icon={<PersonIcon />} mine />
      </div>
      {hasFoot ? (
        <ul className="border-t border-[#EEF0F3] bg-[#FFF8F1]">
          {warnings.map((warning, i) => (
            <li
              key={i}
              className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-6 py-2.5 text-sm text-warn [&+&]:border-t [&+&]:border-[#F6E7D6]"
            >
              <WarnIcon />
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Cell({ cell, icon, mine = false }: { cell: FlowCell; icon: ReactNode; mine?: boolean }) {
  return (
    <div
      className={`min-w-0 px-6 py-5 ${
        mine ? "border-t border-[#EEF0F3] bg-gradient-to-b from-[#F5F9FF] to-surface sm:border-t-0" : ""
      }`}
    >
      <p className={`flex items-center gap-1.5 text-xs font-semibold ${mine ? "text-brand-700" : "text-muted"}`}>
        {icon}
        {cell.label}
      </p>
      <p
        className={`mt-2 break-keep font-extrabold tracking-tight tabular-nums ${
          cell.phrase ? "text-xl leading-snug" : "text-3xl leading-none"
        } ${mine && !cell.phrase ? "text-brand-700" : "text-ink"}`}
      >
        {cell.value}
        {cell.unit ? <span className="ml-1 text-base font-semibold tracking-normal text-muted">{cell.unit}</span> : null}
      </p>
      {cell.line ? <div className="mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 break-keep text-sm text-muted">{cell.line}</div> : null}
      {cell.action ? <div className="mt-3">{cell.action}</div> : null}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[15px] w-[15px] fill-none stroke-current stroke-[1.8]">
      <path d="M5 12l4 4 10-10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[15px] w-[15px] fill-none stroke-current stroke-[1.8]">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" strokeLinecap="round" />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-[#B45309] stroke-[1.9]">
      <path d="M12 4l9 16H3z M12 10v4 M12 17h.01" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
