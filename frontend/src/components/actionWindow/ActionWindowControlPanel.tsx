import type { ActionWindowRunView, CommandType } from "../../lib/actionWindow/contract";
import { commandLabel, SECTION_TITLE } from "../../lib/actionWindow/copy";

/**
 * Action Window control panel. Renders a control ONLY for each command in
 * `run.allowedCommands` — Runtime is the sole authority on what is permitted, so
 * FE never infers or invents command availability.
 */
export function ActionWindowControlPanel({
  run,
  onCommand,
}: {
  run: ActionWindowRunView;
  onCommand: (type: CommandType) => void;
}) {
  const commands = run.allowedCommands;
  // Keep the destructive command (cancel) out of the normal action row so it can
  // never be tapped by reflex alongside benign commands.
  const normal = commands.filter((type) => type !== "CANCEL_RUN");
  const destructive = commands.filter((type) => type === "CANCEL_RUN");

  function commandButton(type: CommandType, variant: "primary" | "secondary" | "destructive") {
    const style =
      variant === "primary"
        ? "bg-brand text-white hover:bg-brand-600"
        : variant === "destructive"
          ? "border border-bad/40 bg-surface text-bad hover:bg-bad/5"
          : "border border-line bg-surface text-ink hover:bg-canvas";
    return (
      <button
        key={type}
        type="button"
        onClick={() => onCommand(type)}
        className={
          "rounded-xl px-4 py-2.5 font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 " +
          style
        }
      >
        {commandLabel(type)}
      </button>
    );
  }

  return (
    <section aria-label={SECTION_TITLE.controls} className="rounded-2xl bg-surface p-5 shadow-card">
      <h2 className="mb-3 text-lg font-semibold text-ink">{SECTION_TITLE.controls}</h2>
      {commands.length === 0 ? (
        <p className="text-muted">지금은 할 수 있는 동작이 없어요.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {normal.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {normal.map((type) =>
                commandButton(
                  type,
                  type === "REQUEST_STEP_RECHECK" || type === "START_RUN" ? "primary" : "secondary",
                ),
              )}
            </div>
          ) : null}
          {destructive.length > 0 ? (
            <div
              className={
                "flex flex-wrap gap-2" +
                (normal.length > 0 ? " border-t border-line pt-3" : "")
              }
            >
              {destructive.map((type) => commandButton(type, "destructive"))}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
