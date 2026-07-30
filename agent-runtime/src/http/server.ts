/**
 * The HTTP transport — a thin, dependency-free wrapper over {@link AgentRunService} using Node's
 * built-in `http`. Keeping the transport this small (no framework) keeps the supply-chain surface
 * minimal and the request-handling auditable in one file.
 *
 * Routes:
 *   GET  /health                                 liveness (public)
 *   GET  /capabilities                           service metadata (public; no seller data)
 *   POST /api/agent-runs                          start a run (bearer required)
 *   POST /api/agent-runs/{threadId}/resume        resume at a checkpoint (bearer required)
 *   GET  /api/agent-runs/{threadId}               read a run's sanitized status (bearer required)
 *
 * Auth: the operator's JWT is forwarded verbatim as `Authorization: Bearer <token>`. This service
 * NEVER validates or mints tokens (it holds no signing key); a missing token is a 401 here, and an
 * invalid token is rejected by the backend on the forwarded call (surfaced as the backend's 401).
 *
 * CORS: the browser calls this service cross-origin, so preflight + the configured allow-origin are
 * handled here. The backend hop is server-to-server and needs no CORS.
 */
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { log } from "../log";
import { HttpError, errorBody, toHttpError } from "./errors";
import { ResumeRunRequestSchema, StartRunRequestSchema } from "./contract";
import type { HealthView } from "./contract";
import { SERVICE_VERSION } from "./config";
import type { RuntimeConfig } from "./config";
import type { AgentRunService } from "./AgentRunService";

const MAX_BODY_BYTES = 128 * 1024;

interface HandlerContext {
  readonly service: AgentRunService;
  readonly config: RuntimeConfig;
}

/** Set CORS headers when the request origin is allow-listed. */
function applyCors(req: IncomingMessage, res: ServerResponse, config: RuntimeConfig): void {
  const origin = req.headers.origin;
  res.setHeader("Vary", "Origin");
  if (typeof origin === "string" && config.corsAllowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "authorization,content-type");
    res.setHeader("Access-Control-Max-Age", "600");
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(payload);
}

function sendError(res: ServerResponse, err: unknown): void {
  const httpErr = toHttpError(err);
  sendJson(res, httpErr.status, errorBody(httpErr));
}

/** Read + JSON-parse the request body with a hard size cap. Empty body → {}. */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_BODY_BYTES) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "request body too large");
    chunks.push(buf);
  }
  if (total === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "INVALID_JSON", "request body is not valid JSON");
  }
}

/** Decode a path segment, mapping a malformed %-escape to a 400 (not a generic 500). */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new HttpError(400, "INVALID_PATH", "malformed path segment");
  }
}

/** Extract the forwarded bearer token; 401 if absent. The token is never logged. */
function requireBearer(req: IncomingMessage): string {
  const header = req.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    throw new HttpError(401, "MISSING_TOKEN", "missing or malformed Authorization bearer token");
  }
  const token = header.slice("Bearer ".length).trim();
  if (token.length === 0) throw new HttpError(401, "MISSING_TOKEN", "missing bearer token");
  return token;
}

async function route(ctx: HandlerContext, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = (req.method ?? "GET").toUpperCase();
  const url = new URL(req.url ?? "/", "http://internal");
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (method === "GET" && path === "/health") {
    const view: HealthView = {
      status: "ok",
      service: "sellerops-agent-runtime",
      version: SERVICE_VERSION,
      env: ctx.config.env,
      runStore: ctx.config.runStoreKind,
    };
    sendJson(res, 200, view);
    return;
  }

  if (method === "GET" && path === "/capabilities") {
    sendJson(res, 200, ctx.service.capabilities());
    return;
  }

  if (method === "POST" && path === "/api/agent-runs") {
    const token = requireBearer(req);
    const parsed = StartRunRequestSchema.safeParse(await readJsonBody(req));
    if (!parsed.success) throw new HttpError(400, "INVALID_REQUEST", "invalid start-run request");
    const view = await ctx.service.start(token, parsed.data);
    sendJson(res, 200, view);
    return;
  }

  const resumeMatch = path.match(/^\/api\/agent-runs\/([^/]+)\/resume$/);
  if (method === "POST" && resumeMatch) {
    const token = requireBearer(req);
    const threadId = safeDecode(resumeMatch[1]!);
    const parsed = ResumeRunRequestSchema.safeParse(await readJsonBody(req));
    if (!parsed.success) throw new HttpError(400, "INVALID_REQUEST", "invalid resume request");
    const view = await ctx.service.resume(token, threadId, parsed.data);
    sendJson(res, 200, view);
    return;
  }

  const getMatch = path.match(/^\/api\/agent-runs\/([^/]+)$/);
  if (method === "GET" && getMatch) {
    const token = requireBearer(req);
    const threadId = safeDecode(getMatch[1]!);
    const view = await ctx.service.get(token, threadId);
    sendJson(res, 200, view);
    return;
  }

  throw new HttpError(404, "NOT_FOUND", "no such route");
}

export function createHttpServer(service: AgentRunService, config: RuntimeConfig): Server {
  const ctx: HandlerContext = { service, config };
  return createServer((req, res) => {
    applyCors(req, res, config);
    route(ctx, req, res).catch((err) => {
      // Log status + a coarse code only — never the token, the body, or the raw error message.
      const httpErr = toHttpError(err);
      log("http_error", { status: httpErr.status, code: httpErr.code, method: req.method ?? "", path: (req.url ?? "").split("?")[0] });
      if (!res.headersSent) sendError(res, httpErr);
      else res.end();
    });
  });
}
