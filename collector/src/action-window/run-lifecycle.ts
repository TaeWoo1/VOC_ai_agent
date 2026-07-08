/**
 * **Operation Run lifecycle (R3).** The thin composition layer that ties the pieces together:
 * create a persisted run from a live `ActionWindowSession`, and restore/resume one after a process
 * restart. It owns NO domain logic — the record shape and restore policy live in `operation-run.ts`,
 * durability in `run-store.ts`, and semantics in the engine.
 *
 * Restart-recovery invariants enforced here:
 *  - a restored resumable run is parked behind the PAUSED barrier (`pauseForRestore`) — an explicit
 *    `RESUME_RUN` command is the ONLY thing that re-drives it (no automatic re-execution on boot);
 *  - the parked state is persisted immediately, so the barrier itself survives another interruption;
 *  - a TERMINAL run restores read-only (its stage accepts no command) and is never re-parked —
 *    completed/cancelled runs cannot restart, accidentally or otherwise.
 */
import type { AwServerTransport } from "../../../contracts/action-window/v1/transport";
import { ActionWindowEngine, type RunConfig } from "./engine";
import { ActionWindowSession, type ProbeDriver } from "./session";
import { operationRunFrom, planRestore, resumeStateFor, type OperationRun, type ResumeState } from "./operation-run";
import { listOperationRunIds, loadOperationRun, saveOperationRun } from "./run-store";

export interface RunSessionDeps {
  /** Store directory. */
  dir: string;
  transport: AwServerTransport;
  driver: ProbeDriver;
}

export interface OpenedRunSession {
  engine: ActionWindowEngine;
  session: ActionWindowSession;
  /** How this session came to exist. */
  origin: "NEW" | "RESUMED";
  /** Resume classification when restored (undefined for a new run). */
  resumeState?: ResumeState;
}

/** Wire the persistence hook: after every published (verified) transition, the run is saved. */
function persistentSession(deps: RunSessionDeps, engine: ActionWindowEngine): ActionWindowSession {
  return new ActionWindowSession(engine, deps.driver, deps.transport, {
    onStatePublished: () => saveOperationRun(deps.dir, operationRunFrom(engine)),
  });
}

/** Create a NEW persisted run. The record first lands on disk at the first published transition. */
export function createPersistentRunSession(deps: RunSessionDeps, config: RunConfig): OpenedRunSession {
  const engine = new ActionWindowEngine(config);
  return { engine, session: persistentSession(deps, engine), origin: "NEW" };
}

/**
 * Restore a loaded record into a live session. Resumable runs are parked at PAUSED (safe stage)
 * and the parked state is saved immediately; terminal runs restore exactly as persisted.
 */
export function resumePersistedRunSession(deps: RunSessionDeps, run: OperationRun): OpenedRunSession {
  const plan = planRestore(run);
  const engine = ActionWindowEngine.restore(plan.state);
  if (plan.safeResumeStage !== null) {
    engine.pauseForRestore(plan.safeResumeStage);
    saveOperationRun(deps.dir, operationRunFrom(engine)); // the barrier survives another crash
  }
  return { engine, session: persistentSession(deps, engine), origin: "RESUMED", resumeState: plan.resumeState };
}

/**
 * The first persisted run that is still resumable (classification recomputed from the persisted
 * engine state — never trusted from the stored `resumeState` field). Terminal runs are skipped and
 * left untouched (history is preserved; they are never restarted).
 */
export function findResumableRun(dir: string): OperationRun | null {
  for (const runId of listOperationRunIds(dir)) {
    const run = loadOperationRun(dir, runId);
    if (run && resumeStateFor(run.engine) !== "TERMINAL") return run;
  }
  return null;
}

/**
 * Boot entry: resume the interrupted persisted run when one exists, otherwise create a new one from
 * `config`. A restarted agent therefore continues its run instead of silently minting a fresh one.
 */
export function openOrResumeRunSession(deps: RunSessionDeps, config: RunConfig): OpenedRunSession {
  const resumable = findResumableRun(deps.dir);
  if (resumable) return resumePersistedRunSession(deps, resumable);
  return createPersistentRunSession(deps, config);
}
