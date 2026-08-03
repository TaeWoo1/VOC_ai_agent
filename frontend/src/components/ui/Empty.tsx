import type { ReactNode } from "react";

/**
 * Honest empty state.
 *
 * An empty surface says what it will hold and what has to happen for it to hold something. It
 * never says "준비 중" or otherwise implies that the product is mid-construction — the state the
 * seller is in is "no data connected yet", which is a different and recoverable fact, and the
 * action tells them how to leave it.
 */
export function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-12 text-center">
      <p className="break-keep text-lg font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-2 max-w-md break-keep leading-relaxed text-muted">{body}</p>
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}
