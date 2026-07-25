/**
 * **Import segment host — the piece that makes an onboarding import a SEQUENCE.**
 *
 * ## Why this exists at all, and why the other two carriers need no equivalent
 *
 * An export or reply agent hosts exactly one run for its lifetime, so its session can be assembled at boot.
 * An import cannot, for a concrete reason: **the launch ref arrives inside `START_RUN`, not at boot.** The
 * ref is a single-use authorization the server mints per segment, and the required window is resolved from
 * it server-side. So at boot the agent knows the channel and the driver and nothing else — it does not know
 * which segment it is about to guide, and it must not guess.
 *
 * And an onboarding import is a sequence: range discovery, then one run per monthly segment, each with its
 * own ticket, all in one sitting without the seller restarting their agent. So this host:
 *
 *  1. announces the import carrier immediately (so a frontend can attach and see an agent is present);
 *  2. intercepts the first `START_RUN`, reads the launch ref out of it, and asks the SERVER what window
 *     that ref authorizes;
 *  3. mints a run identity, re-arms the endpoint with it, assembles the engine + session, and replays the
 *     command into the freshly built session;
 *  4. does the same again for the next segment, without a restart.
 *
 * **Run identity stays Runtime-assigned.** The frontend supplies a launch ref; it never supplies or
 * influences a runId. And the ref is never logged — it authorizes an ingest, so it is treated as a
 * credential.
 *
 * **Scope comes from the server, never from the frontend.** A frontend-supplied window would let a client
 * widen its own import scope; asking the server is what makes the required range trustworthy.
 */
import { deserializeFrame, type AwClientFrame } from "../../../../contracts/action-window/v2/transport";
import type { InitialImportEndpoint } from "../../bridge/initial-import-endpoint";
import { log } from "../../log";
import { assembleImportRun, makeImportRunMarker, mintImportRunId } from "./import-dispatch";
import type { ImportProbeDriver, RequiredRange } from "./import-driver";
import type { ImportSegmentSession } from "./import-session";

/** What the server says a launch ref authorizes. Identity-free by design — no plan or segment id. */
export interface ResolvedLaunchScope {
  /** DISCOVERY or SEGMENT. Only SEGMENT is hostable here. */
  kind: string;
  channelCode: string;
  requiredStart: string;
  requiredEnd: string;
}

export interface ImportHostDeps {
  endpoint: InitialImportEndpoint;
  channelCode: string;
  /**
   * Ask the SERVER what this launch ref authorizes. Injected so the host stays free of HTTP and the
   * collector's `upload.ts` `fetchLaunchScope` is the only place that speaks to the backend.
   */
  resolveScope: (launchRef: string) => Promise<ResolvedLaunchScope | null>;
  /** The driver for each hosted run. On the product path, the LIVE one. */
  driver: ImportProbeDriver;
  persistDir?: string;
}

/**
 * Extract the launch ref from a `START_RUN` command, or null when the frame is not one / carries no ref.
 *
 * Pure and defensive: the frame arrives from a paired client, so nothing about its shape is assumed. Only
 * `importRef` is read — a `discoveryRef` or `submissionRef` on an import carrier is a wiring bug, and
 * refusing rather than accepting it is what keeps a run from binding to the wrong approved work.
 */
export function importRefFromStartRun(frame: AwClientFrame): string | null {
  if (frame.kind !== "aw_command") return null;
  const command = frame.command as { type?: unknown; payload?: { importRef?: unknown; intent?: unknown } };
  if (command.type !== "START_RUN") return null;
  const ref = command.payload?.importRef;
  if (typeof ref !== "string" || !/^[0-9a-f]{16}$/.test(ref)) return null;
  const intent = command.payload?.intent;
  if (intent !== undefined && intent !== "INITIAL_REVIEW_IMPORT_SEGMENT") return null;
  return ref;
}

export class ImportSegmentHost {
  private readonly deps: ImportHostDeps;
  private session: ImportSegmentSession | null = null;
  private hostedRef: string | null = null;
  private detach: (() => void) | null = null;
  private building = false;

  constructor(deps: ImportHostDeps) {
    this.deps = deps;
  }

  /** Begin listening for the first segment's `START_RUN`. */
  attach(): void {
    if (this.detach) return;
    this.detach = this.deps.endpoint.transport.subscribe((frame) => {
      void this.onFrame(frame);
    });
    log("aw_import_host_attached", {});
  }

  /** The currently hosted session, if a segment run has been started. */
  activeSession(): ImportSegmentSession | null {
    return this.session;
  }

  async close(): Promise<void> {
    this.detach?.();
    this.detach = null;
    this.session = null;
    this.hostedRef = null;
  }

  private async onFrame(frame: AwClientFrame): Promise<void> {
    const ref = importRefFromStartRun(frame);
    if (!ref) return;

    // A replayed START_RUN for the run we are already hosting is idempotent — the session's own engine
    // answers it. Rebuilding here would mint a second runId for one authorization.
    if (ref === this.hostedRef) return;
    // Two clients racing a start would otherwise build two sessions for one ticket.
    if (this.building) {
      log("aw_import_host_start_ignored_busy", {});
      return;
    }

    this.building = true;
    try {
      const scope = await this.deps.resolveScope(ref);
      if (!scope) {
        // The server refused: spent, expired, wrong org, or never existed. All the same answer on purpose
        // — a client must not be able to tell them apart by probing.
        log("aw_import_host_scope_refused", {});
        return;
      }
      if (scope.kind !== "SEGMENT") {
        // A discovery ticket is not a segment run. Fail closed rather than guide a window nobody planned.
        log("aw_import_host_wrong_kind", { hostable: false });
        return;
      }

      const required: RequiredRange = { start: scope.requiredStart, end: scope.requiredEnd };
      const runId = mintImportRunId();
      // Re-announce BEFORE the session exists, so an already-attached frontend learns the new run identity
      // and its next command carries a revision the new engine will accept.
      this.deps.endpoint.armRun(runId, scope.channelCode || this.deps.channelCode);

      const assembly = assembleImportRun(this.deps.endpoint.transport, {
        runId,
        channelCode: scope.channelCode || this.deps.channelCode,
        importRef: ref,
        required,
        driver: this.deps.driver,
        ...(this.deps.persistDir ? { persistDir: this.deps.persistDir } : {}),
        now: makeImportRunMarker(),
      });
      this.session = assembly.session;
      this.hostedRef = ref;
      this.session.attach();
      // Neither the ref nor the dates — the ref authorizes an ingest and the dates are the run's business.
      log("aw_import_host_run_hosted", {});

      // Replay the command that triggered this into the new session. The client sent START_RUN once and
      // must not have to send it twice just because the runtime needed to build a session first.
      this.replay(frame, runId);
    } catch {
      // A resolve failure must not take the host down: the seller can retry, and a dead host would look
      // like an agent that is not running at all.
      log("aw_import_host_start_failed", {});
    } finally {
      this.building = false;
    }
  }

  /**
   * Feed the original `START_RUN` into the new session, retargeted at the minted runId.
   *
   * The client addressed the command to whatever run the endpoint had announced before; the session it now
   * reaches is a different run, so the runId is rewritten and the revision reset to 0 — the new engine has
   * no history for this client to be stale against.
   */
  private replay(frame: AwClientFrame, runId: string): void {
    if (frame.kind !== "aw_command") return;
    const original = frame.command as unknown as Record<string, unknown>;
    const retargeted = { ...original, runId, expectedRevision: 0 };
    // Round-trip through the contract's own (de)serializer so the replayed frame is validated exactly as
    // an inbound one would be, rather than trusted because we built it.
    const encoded = JSON.stringify({ kind: "aw_command", command: retargeted });
    let replayed: AwClientFrame;
    try {
      replayed = deserializeFrame(encoded) as AwClientFrame;
    } catch {
      log("aw_import_host_replay_malformed", {});
      return;
    }
    // Publish to the endpoint's listener set, which is what the new session subscribed to. This host is
    // also a listener and will see the frame again — harmless, because the `ref === hostedRef` guard above
    // returns immediately for the run it just built. That guard is what keeps the replay from looping.
    this.deps.endpoint.replayClientFrame(replayed);
  }
}
