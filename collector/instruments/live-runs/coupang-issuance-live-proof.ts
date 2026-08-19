/**
 * **Coupang WING API-issuance guided-walk LIVE-PROOF driver (bridge client) — GATED, read-only, diagnostic.**
 *
 *   npx tsx instruments/live-runs/coupang-issuance-live-proof.ts -- --i-understand-this-opens-live-coupang-wing
 *
 * The Coupang mirror of {@link file://./issuance-live-proof.ts}. It is NOT a browser driver and it never touches
 * WING: it connects to the LOCAL Action-Window bridge that {@link file://./run-coupang-wing-issuance-live.ts}
 * already opened on the seller's dedicated Chrome window, adopts that host's Coupang issuance run, and drives the
 * guided walk's OPENING over `/bridge/ws`:
 *   - pair (`/bridge/pair/request` → `/bridge/pair/poll`) → ws-ticket → `/bridge/ws` (Origin-scoped),
 *   - read the announced `aw_session` runId and send ONE `START_RUN` (intent `API_ISSUANCE_GUIDANCE`), and
 *   - print SANITIZED frames (status / step / blocker only — never a URL, value, or credential).
 *
 * **It cannot advance a checkpoint, and that is deliberate.** It used to send `REQUEST_STEP_RECHECK` once per
 * appearance of a sentinel file the operator touched — a file any process can create, standing in for "I have
 * SEEN the overlay and done what it asks". A diagnostic must not be able to move a live guided walk on to the
 * next instruction. 다음 is the SellerOps frontend's own button, pressed by the seller, in the product path.
 *
 * ## This is a DIAGNOSTIC, not the product path
 *
 * The **browser** is the product path (SellerOps `/connect/coupang` guided walkthrough pairs to the agent and
 * drives the run). This CLI exists only as sanitized evidence/diagnostic for a FUTURE live WING re-run — a CLI
 * success never substitutes for the FE product path. It sends ONE benign guidance command (`START_RUN`); it
 * can no more act on WING than the frontend can, and it can do strictly less. Every real step —
 * login, reaching the open-API page, issuing the key, copying the Access/Secret keys — is the seller's, in their
 * own window. Gated on the explicit Coupang WING approval flag (a NAVER grant never authorizes a WING run) and
 * inert on import (`main` runs only when invoked directly), so hermetic tests import it without connecting.
 */
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";
import { hasCoupangWingRunApproval, coupangWingApprovalRequiredMessage } from "../../src/cli/live-run-approval";

const HTTP_BASE = process.env.BRIDGE_HTTP_BASE ?? "http://127.0.0.1:47615";
const WS_BASE = HTTP_BASE.replace(/^http/, "ws");
const ORIGIN = process.env.BRIDGE_ORIGIN ?? "http://localhost:5173";
const WORKSPACE_LABEL = "SellerOps";
const BRIDGE_PROTOCOL_VERSION = 1;
const AW_PROTOCOL_VERSION = 2;
const AW_TRANSPORT_VERSION = 1;
const EXPECTED_CARRIER = "issuance";
const CHANNEL_CODE = "coupang";
const INTENT = "API_ISSUANCE_GUIDANCE";
const PAIR_POLL_TRIES = 12;
const PAIR_POLL_MS = 300;

const ts = (): string => new Date().toISOString().slice(11, 23);
const line = (...a: unknown[]): void => console.error(`[${ts()}]`, ...a);

function banner(): void {
  const bar = "─".repeat(72);
  console.error(bar);
  console.error(" Coupang WING API-issuance LIVE-PROOF driver (bridge client) — explicit per-run approval required.");
  console.error(" Connects to the ALREADY-APPROVED local bridge that run-coupang-wing-issuance-live opened; it never");
  console.error(" opens/logs-in/clicks WING. It sends ONE command — START_RUN — and then only WATCHES.");
  console.error(" It cannot advance a checkpoint: 다음 is the SellerOps frontend's own button, pressed by you.");
  console.error(" DIAGNOSTIC ONLY — the browser guided walkthrough is the product path; a CLI pass does not replace it.");
  console.error(bar);
}

interface HttpResult {
  status: number;
  ok: boolean;
  json: Record<string, unknown> | null;
}

async function postJson(path: string, body: unknown, token?: string): Promise<HttpResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Origin: ORIGIN };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${HTTP_BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body ?? {}) });
  let json: Record<string, unknown> | null = null;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON response */
  }
  return { status: res.status, ok: res.ok, json };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Pair with the bridge and return the pairing token (the host runs with dev auto-approve during a proof). */
async function pairAndGetToken(): Promise<string> {
  const req = await postJson("/bridge/pair/request", { workspaceLabel: WORKSPACE_LABEL });
  const requestId = typeof req.json?.requestId === "string" ? req.json.requestId : null;
  if (!req.ok || !requestId) {
    throw new Error(`pair/request failed (status=${req.status}); is the bridge up with auto-approve and Origin ${ORIGIN} allow-listed?`);
  }
  for (let i = 0; i < PAIR_POLL_TRIES; i++) {
    const poll = await postJson("/bridge/pair/poll", { requestId });
    const status = poll.json?.status;
    const pairingToken = poll.json?.pairingToken;
    if (status === "paired" && typeof pairingToken === "string") return pairingToken;
    if (status === "denied" || status === "expired") throw new Error(`pairing ${String(status)}`);
    await sleep(PAIR_POLL_MS);
  }
  throw new Error("pairing never reached 'paired' (auto-approve not active?)");
}

async function mintTicket(token: string): Promise<string> {
  const res = await postJson("/bridge/ws-ticket", { clientProtocolVersion: BRIDGE_PROTOCOL_VERSION }, token);
  const ticket = typeof res.json?.ticket === "string" ? res.json.ticket : null;
  if (!res.ok || !ticket) throw new Error(`ws-ticket failed (status=${res.status})`);
  return ticket;
}

/** A single guided-walk session over the adopted Coupang issuance run. Read-only: only the two guidance commands. */
class CoupangLiveProofSession {
  private announcedRunId: string | null = null;
  private latestRevision = 0;
  private started = false;
  private completed = false;

  constructor(private readonly ws: WebSocket) {}

  private sendCommand(command: Record<string, unknown>): void {
    this.ws.send(JSON.stringify({ type: "aw", payload: JSON.stringify({ kind: "aw_command", command }) }));
  }

  private sendStartRun(runId: string): void {
    this.sendCommand({
      protocolVersion: AW_PROTOCOL_VERSION,
      commandId: randomUUID(),
      runId,
      expectedRevision: 0,
      type: "START_RUN",
      payload: { channelCode: CHANNEL_CODE, intent: INTENT },
    });
    line("→ START_RUN", `intent=${INTENT} channelCode=${CHANNEL_CODE}`);
  }

  isDone(): boolean {
    return this.completed;
  }

  handleRaw(data: WebSocket.RawData): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data.toString()) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (msg.type) {
      case "hello":
        line("hello", `protocolVersion=${String(msg.protocolVersion)}`);
        return;
      case "aw_session": {
        line("aw_session", `carrier=${String(msg.carrier)} channelCode=${String(msg.channelCode)}`);
        if (msg.carrier !== EXPECTED_CARRIER) throw new Error(`carrier mismatch: ${String(msg.carrier)}`);
        if (msg.transportVersion !== AW_TRANSPORT_VERSION) throw new Error(`transportVersion mismatch: ${String(msg.transportVersion)}`);
        this.announcedRunId = typeof msg.runId === "string" ? msg.runId : null;
        if (this.announcedRunId && !this.started) {
          this.started = true;
          this.sendStartRun(this.announcedRunId);
        }
        return;
      }
      case "aw": {
        if (typeof msg.payload !== "string") return;
        try {
          this.handleFrame(JSON.parse(msg.payload) as Record<string, unknown>);
        } catch {
          /* ignore an unparseable inner frame */
        }
        return;
      }
      default:
        return;
    }
  }

  /** Print a SANITIZED projection of each frame (status / step / blocker only — never a URL, value, or secret). */
  private handleFrame(frame: Record<string, unknown>): void {
    if (frame.kind === "aw_view") {
      const v = (frame.view ?? {}) as Record<string, unknown>;
      if (typeof v.revision === "number") this.latestRevision = v.revision;
      const step = (v.currentStep ?? {}) as Record<string, unknown>;
      const targetKind = ((step.copyParams ?? {}) as Record<string, unknown>).targetKind ?? "-";
      const blocker = v.blocker as Record<string, unknown> | undefined;
      line(
        "aw_view",
        `status=${String(v.status)} step=${String(step.stepNumber ?? "-")}/${String(step.totalSteps ?? "-")}` +
          ` target=${String(targetKind)} blocker=${blocker ? `${String(blocker.code)}(recoverable=${String(blocker.recoverable)})` : "-"}` +
          ` rev=${String(v.revision)}`,
      );
      if (v.status === "WAITING_FOR_HUMAN" && !blocker) {
        if (targetKind === "reach_open_api") line("  ** NAVIGATE to the WING open-API issuance page — SellerOps observes the transition. **");
        else if (targetKind === "issue") line("  ** 발급 CHECKPOINT — you issue the key yourself in the WING window; SellerOps never clicks it. When done, touch the sentinel to send 다음. **");
        else line(`  ** CHECKPOINT '${String(targetKind)}' — overlay should be visible. Press 다음 in SellerOps when you have. **`);
      }
      if (blocker) line(`  ** RECOVERABLE PARK (${String(blocker.code)}) — press 다음 in SellerOps to re-guide/recover. **`);
      if (v.status === "COMPLETED") {
        this.completed = true;
        line("run COMPLETED");
      }
      return;
    }
    if (frame.kind === "aw_event") {
      const e = (frame.event ?? {}) as Record<string, unknown>;
      line("aw_event", `type=${String(e.type)} seq=${String(e.sequence)} rev=${String(e.revision)}`);
      if (e.type === "RUN_COMPLETED") this.completed = true;
      return;
    }
    if (frame.kind === "aw_command_result") {
      line("aw_command_result", `accepted=${String(frame.accepted)}${frame.reason ? ` reason=${String(frame.reason)}` : ""}`);
    }
  }
}

async function main(): Promise<void> {
  banner();
  const args = process.argv.slice(2);
  if (!hasCoupangWingRunApproval(args)) {
    console.error(coupangWingApprovalRequiredMessage());
    process.exit(3);
    return;
  }
  const token = await pairAndGetToken();
  const ticket = await mintTicket(token);
  const url = `${WS_BASE}/bridge/ws?ticket=${encodeURIComponent(ticket)}`;
  line("ws connect", url.replace(/ticket=[^&]+/, "ticket=<redacted>"));
  const ws = new WebSocket(url, { origin: ORIGIN });
  const session = new CoupangLiveProofSession(ws);

  await new Promise<void>((resolve) => {
    ws.on("open", () => line("ws open"));
    ws.on("message", (data: WebSocket.RawData) => {
      try {
        session.handleRaw(data);
      } catch (e) {
        line("frame error", e instanceof Error ? e.name : typeof e);
      }
      if (session.isDone()) resolve();
    });
    ws.on("error", (err: Error) => line("ws error", err.name));
    ws.on("close", () => {
      line("ws close");
      resolve();
    });
    process.on("SIGINT", () => resolve());
    process.on("SIGTERM", () => resolve());
  });

  try {
    ws.close();
  } catch {
    /* already closing */
  }
}

// Run the client ONLY when invoked directly (never on import) so hermetic tests connect to nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();

export { CoupangLiveProofSession };
