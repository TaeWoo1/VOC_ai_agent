import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * v2 button primitives.
 *
 * `solid` is `bg-brand-700`, not `bg-brand`: white text on #3182F6 measures 3.71:1 and misses AA,
 * while #1B64DA measures 5.41:1. The accent is spent on actions and nowhere else, so this is the
 * only place the strong brand value appears in the app surface.
 *
 * <b>Hover darkens.</b> It used to lighten to `brand-600`, and white on #2272EB measures 4.49:1 —
 * under AA on the most-pressed control in the product, in the state the seller's cursor is in while
 * they read it. Measured in a real browser, composited, on 2026-08-27. `brand-800` is 7.38:1.
 */

export type BtnVariant = "solid" | "outline" | "ghost";
export type BtnSize = "md" | "sm";

const VARIANT: Record<BtnVariant, string> = {
  solid: "bg-brand-700 text-white hover:bg-brand-800 disabled:opacity-50",
  outline: "border border-line bg-surface text-ink hover:bg-canvas disabled:opacity-50",
  ghost: "text-muted hover:text-ink hover:bg-canvas disabled:opacity-50",
};

const SIZE: Record<BtnSize, string> = {
  // 44px minimum touch target at `md`; `sm` is for dense desktop toolbars only.
  // §10: primary 40px on desktop, 36px for dense toolbars. (44px on touch surfaces is the tab bar's job.)
  md: "min-h-[40px] px-4 py-2 text-base",
  sm: "min-h-[36px] px-3 py-1.5 text-sm",
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2";

function classes(variant: BtnVariant, size: BtnSize, className?: string): string {
  return [BASE, VARIANT[variant], SIZE[size], className].filter(Boolean).join(" ");
}

export function Btn({
  variant = "solid",
  size = "md",
  className,
  children,
  ...rest
}: {
  variant?: BtnVariant;
  size?: BtnSize;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={classes(variant, size, className)} {...rest}>
      {children}
    </button>
  );
}

/** Same visual contract as {@link Btn}, for in-app navigation. */
export function BtnLink({
  to,
  variant = "solid",
  size = "md",
  className,
  ariaLabel,
  onClick,
  state,
  children,
}: {
  to: string;
  variant?: BtnVariant;
  size?: BtnSize;
  className?: string;
  /**
   * Fuller accessible name, for a link whose visible label only reads correctly next to what it sits
   * beside — a row's link that says "상품평 22개 보기" is unambiguous on screen and anonymous in a
   * screen reader's link list. It must CONTAIN the visible label (WCAG 2.5.3), so prefix, never replace.
   */
  ariaLabel?: string;
  /** Side effect that must happen as the seller leaves — telemetry, never navigation of its own. */
  onClick?: () => void;
  /**
   * What the destination should know about how it was reached. Carried on the history entry, so a screen
   * that must not act on a bare visit can tell a press from a bookmark. Never data — a closed flag.
   */
  state?: unknown;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={classes(variant, size, className)}
      aria-label={ariaLabel}
      onClick={onClick}
      {...(state === undefined ? {} : { state })}
    >
      {children}
    </Link>
  );
}
