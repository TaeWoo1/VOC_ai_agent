import type { ReactNode } from "react";

/**
 * A collapsed section that looks collapsed.
 *
 * <b>Why this exists.</b> The previous package folded four things behind `<details>` — 필터,
 * 자동 분류, 판매 계정 선택, AI가 확인한 내용 — and styled every `summary` with `list-none`, which
 * removes the browser's own disclosure triangle. Nothing replaced it. Two independent readers
 * looking at the screens with no explanation read the results as dead labels: 「필터 — 라벨만 있고
 * 아무것도 없다」, 「판매 계정 선택 — 고를 것이 화면에 없다」. Progressive disclosure only works if
 * the reader can tell that something is disclosed.
 *
 * The chevron is drawn, not typed: it rotates on open through `group-open:`, so the marker and the
 * state cannot disagree. It is `aria-hidden` because `<summary>` already announces expanded state.
 */
export function Disclosure({
  label,
  note,
  children,
  className = "",
  summaryClassName = "",
  open,
  onOpenChange,
}: {
  /** What is behind the fold. Always a noun phrase a seller would use. */
  label: ReactNode;
  /** Optional quiet suffix — the current selection, or a count of what is inside. */
  note?: ReactNode;
  children: ReactNode;
  className?: string;
  summaryClassName?: string;
  /**
   * 접힘 상태를 바깥이 가질 때만. 생략하면 예전 그대로 브라우저가 소유한다.
   *
   * 이 칸이 생긴 이유는 <b>아무 일도 일어나지 않는 컨트롤</b>이었다: 쿠팡 카드의 「API 연결하기」가 접힌
   * 영역으로 가는 앵커라, 누르면 화면이 조금 움직이고 열려야 할 것은 접힌 채였다.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <details
      className={`group ${className}`}
      open={open}
      onToggle={(e) => onOpenChange?.((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary
        className={`inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold text-muted transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 ${summaryClassName}`}
      >
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90"
        >
          <path
            d="M7.5 4.5 13 10l-5.5 5.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {label}
        {note ? <span className="font-normal">{note}</span> : null}
      </summary>
      {children}
    </details>
  );
}
