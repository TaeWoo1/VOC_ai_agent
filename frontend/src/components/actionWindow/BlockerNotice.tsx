const WRAPPER_CLASS: Record<"standalone" | "nested", string> = {
  // Standalone card on the run detail (rendered above the timeline).
  standalone: "rounded-2xl border border-bad/30 bg-bad/5 p-4",
  // Nested inside the human-checkpoint card.
  nested: "mt-3 rounded-xl border border-bad/30 bg-bad/5 p-3",
};

/**
 * Blocker notice — the ⚠ status block shown when a run hits a blocker. Title/body are
 * FE copy resolved by the caller (via `blockerView`); this component owns the shared
 * markup + the recoverable-badge wording so the two surfaces never drift. `variant`
 * selects the wrapper: `standalone` (run-detail card) or `nested` (inside the
 * checkpoint card). It is a live region (`role="status"`); the ⚠ glyph is decorative.
 */
export function BlockerNotice({
  title,
  body,
  recoverable,
  variant,
}: {
  title: string;
  body: string;
  recoverable: boolean;
  variant: "standalone" | "nested";
}) {
  return (
    <div role="status" className={WRAPPER_CLASS[variant]}>
      <p className="font-medium text-ink">
        <span aria-hidden="true">⚠ </span>
        {title}
        <span className="ml-2 align-middle text-xs text-muted">
          {recoverable ? "다시 시도할 수 있어요" : "복구할 수 없어요"}
        </span>
      </p>
      <p className="mt-0.5 text-sm text-muted">{body}</p>
    </div>
  );
}
