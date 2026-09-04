import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DeviceLinker,
  backendBearer,
  clearDeviceLink,
  deviceDisplayName,
  deviceLinkPath,
  readDeviceLink,
  sameOrigin,
  writeDeviceLink,
} from "../../src/auth/helper-session";

const dirs: string[] = [];
function home(): string {
  const d = mkdtempSync(join(tmpdir(), "helper-session-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const BASE = "http://127.0.0.1:8080";
const LINK = { token: "rvh_test-only", baseUrl: BASE, linkedAt: "2026-09-05T00:00:00.000Z", expiresAt: null };

describe("the device link file", () => {
  it("is 0600 in a 0700 directory, round-trips, and refuses a value that is not a device token", () => {
    const h = home();
    writeDeviceLink(h, LINK);
    expect(statSync(deviceLinkPath(h)).mode & 0o777).toBe(0o600);
    expect(statSync(join(h, ".auth")).mode & 0o777).toBe(0o700);
    expect(readDeviceLink(h)).toEqual(LINK);
    writeDeviceLink(h, { ...LINK, token: "not-a-device-token" });
    expect(readDeviceLink(h)).toBeNull();
    clearDeviceLink(h);
    expect(existsSync(deviceLinkPath(h))).toBe(false);
    expect(readDeviceLink(h)).toBeNull();
  });

  it("never carries an email or a password", () => {
    const h = home();
    writeDeviceLink(h, LINK);
    const text = readFileSync(deviceLinkPath(h), "utf8").toLowerCase();
    expect(text).not.toContain("password");
    expect(text).not.toContain("email");
  });
});

describe("backendBearer — the only way a backend call gets a credential", () => {
  it("returns the linked token for the linked origin and refuses it for another origin", async () => {
    const h = home();
    writeDeviceLink(h, LINK);
    const env = { REVIEWNARY_HELPER_HOME: h, NODE_ENV: "production" };
    await expect(backendBearer({ baseUrl: "http://127.0.0.1:8080/" }, env)).resolves.toBe("rvh_test-only");
    await expect(backendBearer({ baseUrl: "https://elsewhere.example.invalid" }, env)).rejects.toMatchObject({ stage: "login", httpStatus: 401 });
  });

  it("in production there is no password path: an unlinked helper has no session, whatever the env carries", async () => {
    const h = home();
    let loginCalls = 0;
    const fetchImpl = (async () => { loginCalls++; return new Response(JSON.stringify({ token: "jwt" }), { status: 200 }); }) as unknown as typeof fetch;
    await expect(
      backendBearer({ baseUrl: BASE, email: "seller@example.invalid", password: "never" }, { REVIEWNARY_HELPER_HOME: h, NODE_ENV: "production" }, fetchImpl),
    ).rejects.toMatchObject({ stage: "login" });
    expect(loginCalls).toBe(0);
  });

  it("a developer checkout without a link keeps the dev login", async () => {
    const h = home();
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => { seen.push(url); return new Response(JSON.stringify({ token: "jwt" }), { status: 200 }); }) as unknown as typeof fetch;
    await expect(
      backendBearer({ baseUrl: BASE, email: "dev@example.invalid", password: "dev" }, { REVIEWNARY_HELPER_HOME: h, NODE_ENV: "development" }, fetchImpl),
    ).resolves.toBe("jwt");
    expect(seen).toEqual([`${BASE}/api/auth/login`]);
  });

  it("sameOrigin ignores path and trailing slash, and a bad URL is never the same origin", () => {
    expect(sameOrigin("http://a:1/x", "http://a:1")).toBe(true);
    expect(sameOrigin("http://a:1", "http://a:2")).toBe(false);
    expect(sameOrigin("nope", "http://a:1")).toBe(false);
  });

  it("names the machine by platform and arch only", () => {
    expect(deviceDisplayName("darwin", "arm64")).toBe("Mac (arm64)");
    expect(deviceDisplayName("win32", "x64")).toBe("Windows (x64)");
    expect(deviceDisplayName("freebsd", "x64")).toBe("PC (x64)");
  });
});

/** A fake backend: one pending grant, approved by a test, redeemed once. */
function fakeBackend(opts: { approveAfterPolls?: number; deny?: boolean; me?: number } = {}) {
  const calls: string[] = [];
  const scheduled: Array<() => void> = [];
  let polls = 0;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`);
    if (url.endsWith("/api/auth/device/code")) {
      const body = JSON.parse(String(init?.body));
      if (!/^Mac \(/.test(body.deviceName)) throw new Error("device name leaked something");
      return new Response(JSON.stringify({ deviceCode: "dc", userCode: "BCDFGHJK", expiresAt: new Date(Date.now() + 300_000).toISOString(), interval: 3 }), { status: 200 });
    }
    if (url.endsWith("/api/auth/device/token")) {
      polls++;
      if (opts.deny) return new Response(JSON.stringify({ error: "access_denied" }), { status: 400 });
      if (polls < (opts.approveAfterPolls ?? 1)) return new Response(JSON.stringify({ error: "authorization_pending" }), { status: 400 });
      return new Response(JSON.stringify({ token: "rvh_granted", expiresAt: "2027-03-04T00:00:00Z" }), { status: 200 });
    }
    if (url.endsWith("/api/helper-devices/me")) {
      return new Response(opts.me === 401 ? "" : JSON.stringify({ id: "x" }), { status: opts.me ?? 200 });
    }
    throw new Error(`unexpected ${url}`);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls, scheduled, schedule: (fn: () => void) => { scheduled.push(fn); return 0; } };
}

describe("DeviceLinker — start, poll, link, verify, revoke", () => {
  it("links after the seller approves, storing the token 0600 and reporting linked", async () => {
    const h = home();
    const b = fakeBackend({ approveAfterPolls: 2 });
    const linker = new DeviceLinker({ baseUrl: BASE, home: h, helperVersion: "0.2.0", fetchImpl: b.fetchImpl, schedule: b.schedule, deviceName: "Mac (arm64)" });
    const start = await linker.start();
    expect(start).toMatchObject({ ok: true, userCode: "BCDFGHJK" });
    expect(await linker.status()).toMatchObject({ linked: false, linking: "pending" });
    // A second press while pending is refused, not a second grant.
    expect(await linker.start()).toEqual({ ok: false, reason: "busy" });
    b.scheduled.shift()!();
    await new Promise((r) => setTimeout(r, 5));
    expect(await linker.status()).toMatchObject({ linked: false, linking: "pending" });
    b.scheduled.shift()!();
    await new Promise((r) => setTimeout(r, 5));
    expect(readDeviceLink(h)?.token).toBe("rvh_granted");
    expect(statSync(deviceLinkPath(h)).mode & 0o777).toBe(0o600);
    expect(await linker.status()).toMatchObject({ linked: true, linking: null, verified: "OK" });
    expect(await linker.start()).toEqual({ ok: false, reason: "already_linked" });
    // The token itself never appears in any call path.
    expect(b.calls.join(" ")).not.toContain("rvh_");
  });

  it("a denied grant ends as denied with nothing stored", async () => {
    const h = home();
    const b = fakeBackend({ deny: true });
    const linker = new DeviceLinker({ baseUrl: BASE, home: h, helperVersion: "0.2.0", fetchImpl: b.fetchImpl, schedule: b.schedule, deviceName: "Mac (arm64)" });
    await linker.start();
    b.scheduled.shift()!();
    await new Promise((r) => setTimeout(r, 5));
    expect(await linker.status()).toMatchObject({ linked: false, linking: "denied" });
    expect(readDeviceLink(h)).toBeNull();
  });

  it("a backend that no longer honours the token makes the helper forget it", async () => {
    const h = home();
    writeDeviceLink(h, LINK);
    const b = fakeBackend({ me: 401 });
    const linker = new DeviceLinker({ baseUrl: BASE, home: h, helperVersion: "0.2.0", fetchImpl: b.fetchImpl, schedule: b.schedule, deviceName: "Mac (arm64)" });
    expect(await linker.status()).toMatchObject({ linked: false, verified: "REVOKED" });
    expect(readDeviceLink(h)).toBeNull();
  });

  it("an unreachable backend keeps the token and says so", async () => {
    const h = home();
    writeDeviceLink(h, LINK);
    const fetchImpl = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    const linker = new DeviceLinker({ baseUrl: BASE, home: h, helperVersion: "0.2.0", fetchImpl, schedule: () => 0, deviceName: "Mac (arm64)" });
    expect(await linker.status()).toMatchObject({ linked: true, verified: "UNREACHABLE" });
    expect(await linker.start()).toEqual({ ok: false, reason: "already_linked" });
    expect(readDeviceLink(h)).toEqual(LINK);
  });

  it("unlink revokes best-effort and forgets the token", async () => {
    const h = home();
    writeDeviceLink(h, LINK);
    const b = fakeBackend();
    const linker = new DeviceLinker({ baseUrl: BASE, home: h, helperVersion: "0.2.0", fetchImpl: b.fetchImpl, schedule: b.schedule, deviceName: "Mac (arm64)" });
    await linker.unlink();
    expect(b.calls).toEqual(["DELETE /api/helper-devices/me"]);
    expect(readDeviceLink(h)).toBeNull();
  });
});
