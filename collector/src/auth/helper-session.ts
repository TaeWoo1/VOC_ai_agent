/**
 * **Helper Device Authentication v1 — the helper's own credential** (docs/helper_device_authentication_v1.md).
 *
 * The helper used to log in to the reviewnary backend as the seller: `SELLEROPS_EMAIL` + `SELLEROPS_PASSWORD`,
 * kept in a 0600 file and POSTed to `/api/auth/login` at every run. This module replaces that with a token the
 * seller GRANTS to this installation from a browser session (RFC 8628 device authorization, minimal): the
 * helper asks the backend for a device code, the browser — already signed in, by password or Google or
 * NAVER — approves the user code, the helper redeems the device code once and keeps the resulting opaque,
 * scoped, revocable token in `<home>/.auth/device.json` (dir 0700, file 0600). No seller password is ever
 * held, asked for, or transmitted by this process.
 *
 * Words on the wire: `token` (the helper's credential), `userCode` / `deviceCode` (the grant's two halves).
 * None of them is ever logged; the log carries outcomes only.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { arch as osArch, platform as osPlatform } from "node:os";
import { dirname, resolve } from "node:path";
import { helperHome } from "../config";
import { log } from "../log";
import { login, UploadError } from "../upload";

export const DEVICE_LINK_DIR = ".auth";
export const DEVICE_LINK_FILE = "device.json";
/** The backend's device-token prefix; a stored value without it is not a token this helper wrote. */
export const DEVICE_TOKEN_PREFIX = "rvh_";

export interface DeviceLink {
  token: string;
  /** The backend origin the token was granted by; a token is never presented to a different origin. */
  baseUrl: string;
  linkedAt: string;
  expiresAt: string | null;
}

export function deviceLinkPath(home: string): string {
  return resolve(home, DEVICE_LINK_DIR, DEVICE_LINK_FILE);
}

function isDeviceLink(value: unknown): value is DeviceLink {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.token === "string" && v.token.startsWith(DEVICE_TOKEN_PREFIX)
    && typeof v.baseUrl === "string" && typeof v.linkedAt === "string"
    && (v.expiresAt === null || typeof v.expiresAt === "string");
}

export function readDeviceLink(home: string): DeviceLink | null {
  const path = deviceLinkPath(home);
  try {
    if (!existsSync(path)) return null;
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isDeviceLink(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 0700 dir, 0600 file, written beside and renamed over — the same posture as the pairing store. */
export function writeDeviceLink(home: string, link: DeviceLink): void {
  const path = deviceLinkPath(home);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(link, null, 2), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

export function clearDeviceLink(home: string): void {
  const path = deviceLinkPath(home);
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // nothing to clear, or nothing we can do about it here
  }
}

export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** The closed, seller-readable name this installation reports about itself. Never a hostname or user name. */
export function deviceDisplayName(platform: string = osPlatform(), arch: string = osArch()): string {
  const os = platform === "darwin" ? "Mac" : platform === "win32" ? "Windows" : platform === "linux" ? "Linux" : "PC";
  return `${os} (${arch})`;
}

export interface SessionSource {
  baseUrl: string;
  /** Developer checkout only; the packaged helper (NODE_ENV=production) never reads these. */
  email?: string;
  password?: string;
}

/**
 * The bearer every backend call uses. Production: the linked device token or nothing — there is no password
 * path to fall back to, by construction. A developer checkout without a link keeps the dev login.
 */
export async function backendBearer(
  cfg: SessionSource,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const link = readDeviceLink(helperHome(env));
  if (link && sameOrigin(link.baseUrl, cfg.baseUrl)) return link.token;
  if (env.NODE_ENV !== "production" && cfg.email && cfg.password) {
    return login(cfg.baseUrl, cfg.email, cfg.password, fetchImpl);
  }
  throw new UploadError("no helper session: this device is not linked", "login", 401);
}

// ---- The link flow, as the resident helper runs it ------------------------------------------------------

export type DeviceLinking = "pending" | "denied" | "expired" | "unreachable" | null;
export type DeviceVerification = "OK" | "REVOKED" | "UNREACHABLE" | "UNVERIFIED";

/** What the bridge reports to the paired browser. Booleans and closed words only. */
export interface DeviceLinkStatus {
  linked: boolean;
  linking: DeviceLinking;
  verified: DeviceVerification;
  helperVersion: string;
}

export type DeviceLinkStart =
  | { ok: true; userCode: string; expiresAt: string }
  | { ok: false; reason: "unreachable" | "busy" | "already_linked" };

export interface DeviceLinkerDeps {
  baseUrl: string;
  home: string;
  helperVersion: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Injectable scheduler so the poll loop can be driven deterministically in tests. */
  schedule?: (fn: () => void, ms: number) => unknown;
  deviceName?: string;
}

/** How long a "still honoured" answer is trusted before the backend is asked again — a revoke made in 설정
 * reaches the card within this plus the card's own slow poll (≈20 s worst case), and no backend call is made
 * more often than this for a helper that is merely being looked at. */
const VERIFY_INTERVAL_MS = 10_000;

export class DeviceLinker {
  private readonly baseUrl: string;
  private readonly home: string;
  private readonly helperVersion: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly deviceName: string;
  private linking: DeviceLinking = null;
  private inFlight: { deviceCode: string; expiresAtMs: number; intervalMs: number } | null = null;
  private lastVerify: { atMs: number; verdict: DeviceVerification } | null = null;
  private stopped = false;

  constructor(deps: DeviceLinkerDeps) {
    this.baseUrl = deps.baseUrl;
    this.home = deps.home;
    this.helperVersion = deps.helperVersion;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.now = deps.now ?? (() => Date.now());
    this.schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.deviceName = deps.deviceName ?? deviceDisplayName();
  }

  /** Ask the backend for a grant and start polling for its approval. One in flight at a time. */
  async start(): Promise<DeviceLinkStart> {
    if (readDeviceLink(this.home)) return { ok: false, reason: "already_linked" };
    if (this.inFlight && this.inFlight.expiresAtMs > this.now()) {
      // A press while a grant is pending does not mint a second code; the browser gets the same one back
      // only if it kept it — so we refuse rather than invent. The caller waits for status.
      return { ok: false, reason: "busy" };
    }
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/auth/device/code`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceName: this.deviceName, helperVersion: this.helperVersion }),
      });
    } catch {
      log("device_link_start", { ok: false, reason: "unreachable" }, "warn");
      return { ok: false, reason: "unreachable" };
    }
    if (res.status === 503) return { ok: false, reason: "busy" };
    if (!res.ok) {
      log("device_link_start", { ok: false, reason: "refused", status: res.status }, "warn");
      return { ok: false, reason: "unreachable" };
    }
    const body = (await res.json()) as { deviceCode?: unknown; userCode?: unknown; expiresAt?: unknown; interval?: unknown };
    if (typeof body.deviceCode !== "string" || typeof body.userCode !== "string" || typeof body.expiresAt !== "string") {
      return { ok: false, reason: "unreachable" };
    }
    const intervalMs = Math.max(1_000, (typeof body.interval === "number" ? body.interval : 3) * 1_000);
    this.inFlight = { deviceCode: body.deviceCode, expiresAtMs: Date.parse(body.expiresAt), intervalMs };
    this.linking = "pending";
    log("device_link_start", { ok: true });
    this.schedule(() => void this.pollOnce(), intervalMs);
    return { ok: true, userCode: body.userCode, expiresAt: body.expiresAt };
  }

  /** One poll of the token endpoint; reschedules itself while the grant is pending. Exposed for tests. */
  async pollOnce(): Promise<void> {
    const flight = this.inFlight;
    if (!flight || this.stopped) return;
    if (flight.expiresAtMs <= this.now()) {
      this.inFlight = null;
      this.linking = "expired";
      log("device_link_result", { outcome: "expired" });
      return;
    }
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/auth/device/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceCode: flight.deviceCode }),
      });
    } catch {
      this.linking = "unreachable";
      this.schedule(() => void this.pollOnce(), flight.intervalMs);
      return;
    }
    if (res.ok) {
      const body = (await res.json()) as { token?: unknown; expiresAt?: unknown };
      if (typeof body.token === "string" && body.token.startsWith(DEVICE_TOKEN_PREFIX)) {
        writeDeviceLink(this.home, {
          token: body.token,
          baseUrl: this.baseUrl,
          linkedAt: new Date(this.now()).toISOString(),
          expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : null,
        });
        this.inFlight = null;
        this.linking = null;
        this.lastVerify = { atMs: this.now(), verdict: "OK" };
        log("device_link_result", { outcome: "linked" });
        return;
      }
      this.inFlight = null;
      this.linking = "unreachable";
      log("device_link_result", { outcome: "malformed" }, "warn");
      return;
    }
    let error = "";
    try {
      error = String(((await res.json()) as { error?: unknown }).error ?? "");
    } catch {
      error = "";
    }
    if (error === "authorization_pending") {
      this.linking = "pending";
      this.schedule(() => void this.pollOnce(), flight.intervalMs);
      return;
    }
    this.inFlight = null;
    this.linking = error === "access_denied" ? "denied" : "expired";
    log("device_link_result", { outcome: this.linking });
  }

  /** Linked or not, and — at most every 10 s — whether the backend still honours the token. */
  async status(): Promise<DeviceLinkStatus> {
    const link = readDeviceLink(this.home);
    if (!link) return { linked: false, linking: this.linking, verified: "UNVERIFIED", helperVersion: this.helperVersion };
    const verdict = await this.verify(link);
    return { linked: verdict !== "REVOKED", linking: null, verified: verdict, helperVersion: this.helperVersion };
  }

  private async verify(link: DeviceLink): Promise<DeviceVerification> {
    if (this.lastVerify && this.now() - this.lastVerify.atMs < VERIFY_INTERVAL_MS) return this.lastVerify.verdict;
    let verdict: DeviceVerification;
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/helper-devices/me`, {
        headers: { authorization: `Bearer ${link.token}` },
      });
      if (res.ok) verdict = "OK";
      else if (res.status === 401) {
        // The seller revoked this helper (or the token expired): the file is now a dead credential — drop it.
        clearDeviceLink(this.home);
        log("device_link_revoked", {});
        verdict = "REVOKED";
      } else verdict = "UNREACHABLE";
    } catch {
      verdict = "UNREACHABLE";
    }
    this.lastVerify = { atMs: this.now(), verdict };
    return verdict;
  }

  /** Uninstall / seller-initiated unlink from this side: best-effort revoke, then forget the token. */
  async unlink(): Promise<void> {
    const link = readDeviceLink(this.home);
    if (link) {
      try {
        await this.fetchImpl(`${this.baseUrl}/api/helper-devices/me`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${link.token}` },
        });
      } catch {
        // revoke is best effort; the seller can also revoke from 설정
      }
    }
    clearDeviceLink(this.home);
    this.lastVerify = null;
  }

  stop(): void {
    this.stopped = true;
  }
}
