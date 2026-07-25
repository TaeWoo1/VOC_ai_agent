/**
 * **Import host — the piece that makes an onboarding import a SEQUENCE.**
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
 * **Two run kinds, one host.** The SERVER decides which: a `DISCOVERY` ticket assembles the range-discovery
 * run that creates the plan, a `SEGMENT` ticket assembles one guided monthly export. The host never infers the
 * kind from the frontend's intent — the ref is the authorization and the server is the authority on what it
 * authorizes, so a client cannot start a discovery run with a segment's ticket by relabelling its command.
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
import { assembleDiscoveryRun, assembleImportRun, makeImportRunMarker, mintImportRunId } from "./import-dispatch";
import type { ImportDiscoveryDriver, ImportProbeDriver, RequiredRange } from "./import-driver";
import type { ImportDiscoverySession } from "./discovery-session";
import type { ImportSegmentSession } from "./import-session";

/** What the server says a launch ref authorizes. Identity-free by design — no plan or segment id. */
export interface ResolvedLaunchScope {
  /** DISCOVERY or SEGMENT. The SERVER decides; the host never infers it from the client's command. */
  kind: string;
  channelCode: string;
  /** The window to guide, for a SEGMENT run. Empty on a DISCOVERY run, which has no window yet. */
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
  /**
   * The driver for each hosted run. On the product path, the LIVE one — which implements both roles, because
   * both run kinds drive the same two date controls on the same surface.
   */
  driver: ImportProbeDriver & ImportDiscoveryDriver;
  persistDir?: string;
}

/**
 * Extract the launch ref from a `START_RUN` command, or null when the frame is not one / carries no ref.
 *
 * Pure and defensive: the frame arrives from a paired client, so nothing about its shape is assumed.
 *
 * **Exactly one of `importRef` / `discoveryRef`, matching the intent.** The contract's `INTENT_REQUIRED_REF`
 * says each intent carries one specific binding ref and prohibits the others; a `submissionRef` here, or both
 * import refs at once, is a wiring bug that would bind a run to the wrong approved work. The ref this returns
 * is only a candidate — what it actually authorizes is decided by the SERVER, so a mismatched intent cannot
 * turn a segment ticket into a discovery run.
 */
export function importRefFromStartRun(frame: AwClientFrame): string | null {
  if (frame.kind !== "aw_command") return null;
  const command = frame.command as {
    type?: unknown;
    payload?: { importRef?: unknown; discoveryRef?: unknown; submissionRef?: unknown; intent?: unknown };
  };
  if (command.type !== "START_RUN") return null;
  const payload = command.payload ?? {};
  if (payload.submissionRef !== undefined) return null;
  const importRef = typeof payload.importRef === "string" ? payload.importRef : null;
  const discoveryRef = typeof payload.discoveryRef === "string" ? payload.discoveryRef : null;
  // Both present is not "the caller was generous" — it is a caller that does not know which run it is
  // starting, and picking one would be a guess about which approved work to spend.
  if (importRef !== null && discoveryRef !== null) return null;
  const ref = importRef ?? discoveryRef;
  if (ref === null || !/^[0-9a-f]{16}$/.test(ref)) return null;
  const intent = command.payload?.intent;
  if (intent === undefined) return ref;
  if (intent === "INITIAL_REVIEW_IMPORT_SEGMENT") return importRef;
  if (intent === "INITIAL_REVIEW_IMPORT_DISCOVERY") return discoveryRef;
  return null;
}

/** Which run kind the client SAYS it is starting, or null when it declared no intent (v1-compatible). */
export type DeclaredImportKind = "SEGMENT" | "DISCOVERY" | null;

/**
 * Read the declared kind out of a `START_RUN`.
 *
 * Only ever used to CROSS-CHECK the server's answer, never to decide anything: the ticket is the
 * authorization and the server is the authority on what it authorizes. But a client that declares one kind
 * while presenting the other's ticket is a wiring bug, and a runtime that quietly ran the server's kind would
 * guide a choreography the frontend is not rendering — so the disagreement fails closed instead.
 */
export function declaredImportKindFromStartRun(frame: AwClientFrame): DeclaredImportKind {
  if (frame.kind !== "aw_command") return null;
  const intent = (frame.command as { payload?: { intent?: unknown } }).payload?.intent;
  if (intent === "INITIAL_REVIEW_IMPORT_SEGMENT") return "SEGMENT";
  if (intent === "INITIAL_REVIEW_IMPORT_DISCOVERY") return "DISCOVERY";
  return null;
}

export class ImportSegmentHost {
  private readonly deps: ImportHostDeps;
  private session: ImportSegmentSession | null = null;
  private discoverySession: ImportDiscoverySession | null = null;
  /**
   * The hosted session's own transport subscription.
   *
   * Held so it can be RELEASED when the next run is hosted. Without this, every session a sequence built
   * stayed subscribed to the endpoint for the agent's whole life: the finished run kept answering commands and
   * publishing its own views, so a frontend part-way through segment two would receive interleaved state from
   * segment one — with the older run winning whenever its revision happened to be higher.
   */
  private sessionDetach: (() => void) | null = null;
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

  /** The currently hosted segment session, if a segment run has been started. */
  activeSession(): ImportSegmentSession | null {
    return this.session;
  }

  /** The currently hosted discovery session, if a discovery run has been started. */
  activeDiscoverySession(): ImportDiscoverySession | null {
    return this.discoverySession;
  }

  async close(): Promise<void> {
    this.detach?.();
    this.detach = null;
    this.releaseHostedSession();
    this.hostedRef = null;
  }

  /** Detach whatever run is hosted, so exactly one session is ever subscribed to the endpoint. */
  private releaseHostedSession(): void {
    this.sessionDetach?.();
    this.sessionDetach = null;
    this.session = null;
    this.discoverySession = null;
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
      if (scope.kind !== "SEGMENT" && scope.kind !== "DISCOVERY") {
        // An unrecognised kind is a newer server talking to an older agent. Fail closed rather than guess
        // which choreography it meant.
        log("aw_import_host_wrong_kind", { hostable: false });
        return;
      }
      const declared = declaredImportKindFromStartRun(frame);
      if (declared !== null && declared !== scope.kind) {
        // The client asked for one choreography and holds the other's ticket. Neither answer is safe: running
        // the server's kind guides a run the frontend is not rendering, and running the client's would spend a
        // ticket on work it does not authorize.
        log("aw_import_host_kind_mismatch", { hostable: false });
        return;
      }
      if (scope.kind === "SEGMENT" && (!scope.requiredStart || !scope.requiredEnd)) {
        // A segment run with no window to match has no gate to pass. Refusing here is what keeps a file
        // covering an unknown period from being ingested as though it covered a planned one.
        log("aw_import_host_scope_incomplete", { hostable: false });
        return;
      }

      const channelCode = scope.channelCode || this.deps.channelCode;
      const runId = mintImportRunId();
      // Re-announce BEFORE the session exists, so an already-attached frontend learns the new run identity
      // and its next command carries a revision the new engine will accept.
      this.deps.endpoint.armRun(runId, channelCode);
      // Release the previous run's subscription first: one hosted session at a time, always.
      this.releaseHostedSession();

      if (scope.kind === "DISCOVERY") {
        const assembly = assembleDiscoveryRun(this.deps.endpoint.transport, {
          runId,
          channelCode,
          discoveryRef: ref,
          driver: this.deps.driver,
        });
        this.discoverySession = assembly.session;
        this.hostedRef = ref;
        this.sessionDetach = assembly.session.attach();
        log("aw_import_host_run_hosted", { kind: "DISCOVERY" });
        this.replay(frame, runId);
        return;
      }

      const required: RequiredRange = { start: scope.requiredStart, end: scope.requiredEnd };
      const assembly = assembleImportRun(this.deps.endpoint.transport, {
        runId,
        channelCode,
        importRef: ref,
        required,
        driver: this.deps.driver,
        ...(this.deps.persistDir ? { persistDir: this.deps.persistDir } : {}),
        now: makeImportRunMarker(),
      });
      this.session = assembly.session;
      this.hostedRef = ref;
      this.sessionDetach = assembly.session.attach();
      // Neither the ref nor the dates — the ref authorizes an ingest and the dates are the run's business.
      log("aw_import_host_run_hosted", { kind: "SEGMENT" });

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
