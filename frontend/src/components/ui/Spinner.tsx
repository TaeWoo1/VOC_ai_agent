/**
 * A small inline activity spinner for "this is in progress" states (the connection test, the first sync,
 * the guided-walk preparation). Purely decorative — `aria-hidden` — so the surrounding `role="status"` text
 * carries the meaning for assistive tech; it exists so a waiting screen is visually distinct from a settled
 * success or error at a glance. Uses the brand token and the built-in `animate-spin` utility only.
 */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-testid="spinner"
      className={[
        "inline-block h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-brand/30 border-t-brand",
        className,
      ].join(" ")}
    />
  );
}
