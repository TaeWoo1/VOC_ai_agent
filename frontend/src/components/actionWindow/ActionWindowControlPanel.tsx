import type { ActionWindowRunView, CommandType } from "../../lib/actionWindow/contract";
import { commandLabel } from "../../lib/actionWindow/copy";

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

  return (
    <section aria-label="가능한 동작" className="rounded-2xl bg-surface p-5 shadow-card">
      <h2 className="mb-3 text-lg font-semibold text-ink">가능한 동작</h2>
      {commands.length === 0 ? (
        <p className="text-muted">지금은 할 수 있는 동작이 없어요.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {commands.map((type) => {
            const primary = type === "REQUEST_STEP_RECHECK" || type === "START_RUN";
            return (
              <button
                key={type}
                type="button"
                onClick={() => onCommand(type)}
                aria-label={commandLabel(type)}
                className={
                  "rounded-xl px-4 py-2.5 font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 " +
                  (primary
                    ? "bg-brand text-white hover:bg-brand-600"
                    : "border border-line bg-surface text-ink hover:bg-canvas")
                }
              >
                {commandLabel(type)}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
