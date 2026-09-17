/**
 * **The owned surface is served only when a helper was told to host it, and never guesses what it is showing.**
 *
 * The page's own contract is pinned in `customer-operations-fixture.test.ts`. This pins the endpoint: that an
 * ordinary helper hosts nothing, that a mistyped dataset is a refusal rather than a default, and that the
 * response says it must not be cached and may load nothing from anywhere. The middle one carries the proof:
 * if an unknown name quietly rendered «initial», a changed surface could read as unchanged and the whole
 * scheduled observation would be untrustworthy in exactly the direction nobody would notice.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { BridgeServer } from "../../src/bridge/bridge-server";
import { FilePairingStore } from "../../src/bridge/pairing-store";
import { FIXTURE_OBSERVE_PATH } from "../../src/aside/fixture-observe-workflow";
import { FIXTURE_ADDED_REF, type FixtureDataset } from "../../src/bridge/customer-operations-fixture";
import { fakeApprovalPresenter } from "./helpers";

const APP = "http://localhost:5173";
const cleanups: Array<() => Promise<void>> = [];
const approval = fakeApprovalPresenter();

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function startServer(dataset?: FixtureDataset) {
  const dir = mkdtempSync(join(tmpdir(), `co-fixture-${randomUUID()}-`));
  const store = new FilePairingStore(join(dir, "pairings.json"), { now: () => Date.now() });
  const server = new BridgeServer({
    store,
    allowedOrigins: [APP],
    agentVersion: "test",
    port: 0,
    approvalPresenter: approval.presenter,
    ...(dataset ? { customerOperationsFixture: { dataset: () => dataset } } : {}),
  });
  const { port } = await server.listen();
  cleanups.push(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { port };
}

function get(port: number, query = ""): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${FIXTURE_OBSERVE_PATH}${query}`);
}

describe("the owned surface route — hosting is a deliberate act", () => {
  it("an ordinary helper hosts no such page", async () => {
    const { port } = await startServer();
    const res = await get(port);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("data-co-surface");
  });

  it("a helper told to host it serves the surface it was told to show", async () => {
    const { port } = await startServer("initial");
    const res = await get(port);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain('data-co-surface="customer-operations-fixture"');
    expect(html).toContain('data-co-item="co-0001"');
  });
});

describe("the owned surface route — an unknown dataset is refused, never defaulted", () => {
  it("refuses a name it does not publish", async () => {
    const { port } = await startServer("initial");
    for (const bad of ["?dataset=marketplace", "?dataset=", "?dataset=INITIAL", "?dataset=changed%20"]) {
      const res = await get(port, bad);
      expect(res.status, bad).toBe(404);
      expect(await res.text()).not.toContain("data-co-surface");
    }
  });

  it("serves each published dataset, and they differ by exactly the added item", async () => {
    const { port } = await startServer("initial");
    const initial = await (await get(port, "?dataset=initial")).text();
    const unchanged = await (await get(port, "?dataset=unchanged")).text();
    const changed = await (await get(port, "?dataset=changed")).text();

    expect(unchanged.replace(/data-co-dataset="[a-z]+"/, "")).toBe(initial.replace(/data-co-dataset="[a-z]+"/, ""));
    expect(initial).not.toContain(FIXTURE_ADDED_REF);
    expect(changed).toContain(FIXTURE_ADDED_REF);
  });
});

describe("the owned surface route — the response asks for nothing and keeps nothing", () => {
  it("is uncacheable and may load no outside resource", async () => {
    const { port } = await startServer("initial");
    const res = await get(port);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
  });
});
