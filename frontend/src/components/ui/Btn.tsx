import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * v2 button primitives.
 *
 * `solid` is `bg-brand-700`, not `bg-brand`: white text on #3182F6 measures 3.71:1 and misses AA,
 * while #1B64DA measures 5.41:1. The accent is spent on actions and nowhere else, so this is the
 * only place the strong brand value appears in the app surface.
 */

export type BtnVariant = "solid" | "outline" | "ghost";
export type BtnSize = "md" | "sm";

const VARIANT: Record<BtnVariant, string> = {
  solid: "bg-brand-700 text-white hover:bg-brand-600 disabled:opacity-50",
  outline: "border border-line text-ink hover:bg-canvas disabled:opacity-50",
  ghost: "text-muted hover:text-ink hover:bg-canvas disabled:opacity-50",
};

const SIZE: Record<BtnSize, string> = {
  // 44px minimum touch target at `md`; `sm` is for dense desktop toolbars only.
  md: "min-h-[44px] px-5 py-2.5 text-base",
  sm: "min-h-[36px] px-3 py-1.5 text-sm",
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2";

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
  children: ReactNode;
}) {
  return (
    <Link to={to} className={classes(variant, size, className)} aria-label={ariaLabel}>
      {children}
    </Link>
  );
}
