import type { ReactNode } from "react";

/**
 * The one notice shape inside the auth shell (docs/service_readiness_v1.md §2-6): a title in the seller's
 * words, one explaining sentence, and a tone. `error` is announced (`role=alert`); the others are `status`.
 * Every auth screen speaks through this — no page invents its own box.
 */
export type AuthNoticeTone = "info" | "success" | "error";

const TONE: Record<AuthNoticeTone, string> = {
  info: "border-line bg-canvas",
  success: "border-good/40 bg-good/5",
  error: "border-bad/40 bg-bad/5",
};

export function AuthNotice({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: AuthNoticeTone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`rounded-xl border px-5 py-4 ${TONE[tone]}`} role={tone === "error" ? "alert" : "status"}>
      <p className="text-base font-semibold text-ink">{title}</p>
      {children ? <p className="mt-1 break-keep text-sm leading-relaxed text-muted">{children}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
