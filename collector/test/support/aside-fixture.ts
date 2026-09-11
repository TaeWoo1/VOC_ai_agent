/**
 * **The local fixture surface the Aside provider is proven against — no marketplace, no NAVER.**
 *
 * A tiny HTTP server on loopback that serves a review-export-shaped page: a store identity marker, two date
 * inputs, an apply control, and ONE export anchor whose download is the committed golden workbook
 * (`contracts/review-export/naver/v1`). Query flags turn on the failure shapes the provider must fail closed
 * on: a login form (`auth=1`), a duplicated export control (`dup=1`), a different store (`store=...`), no
 * export control at all (`noexport=1`), a download that never completes (`stall=1`).
 *
 * Shared by the offline executor tests (through the fake CLI, which never opens it) and the opt-in real-Aside
 * E2E (which does). The workflow below is the ONE workflow both use — a NAVER workflow is M3 and not here.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import type { ExportWorkflow } from "../../src/aside/export-workflow";
import { REQUIRED_START_TOKEN, REQUIRED_END_TOKEN } from "../../src/aside/export-workflow";
import { REVIEW_EXPORT_FIXTURE_PATH } from "./review-export-fixture";

export const FIXTURE_STORE_ID = "fixture-store-42";
export const FIXTURE_EXPORT_NAME = "fixture-review-export.xlsx";

export function fixtureExportBytes(): Uint8Array {
  return new Uint8Array(readFileSync(REVIEW_EXPORT_FIXTURE_PATH));
}

function page(query: URLSearchParams): string {
  const store = query.get("store") ?? FIXTURE_STORE_ID;
  const auth = query.get("auth") === "1";
  const dup = query.get("dup") === "1";
  const noexport = query.get("noexport") === "1";
  const stall = query.get("stall") === "1";
  const href = stall ? "/export-stall.xlsx" : "/export.xlsx";
  const exportControl = noexport
    ? ""
    : `<a id="export" class="export" href="${href}" download="${FIXTURE_EXPORT_NAME}">엑셀 다운로드</a>` +
      (dup ? `<a class="export" href="${href}" download="${FIXTURE_EXPORT_NAME}">엑셀 다운로드 (2)</a>` : "");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Reviewnary Aside fixture</title></head><body>
<h1 id="store-name">${store}</h1>
${auth ? `<form id="login-form"><input name="id"><input name="pw" type="password"><button>로그인</button></form>` : ""}
<form id="range" onsubmit="return false">
  <input id="start" name="start" value="">
  <input id="end" name="end" value="">
  <button id="apply" type="button" onclick="document.getElementById('applied').textContent='applied'">조회</button>
  <span id="applied"></span>
</form>
${exportControl}
</body></html>`;
}

export interface FixtureServer {
  baseUrl: string;
  close(): Promise<void>;
  /** How many export downloads were served — the E2E's "did a file actually leave" counter. */
  exportsServed(): number;
}

export async function startAsideFixtureServer(): Promise<FixtureServer> {
  const bytes = fixtureExportBytes();
  let served = 0;
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/export.xlsx") {
      served += 1;
      res.writeHead(200, {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${FIXTURE_EXPORT_NAME}"`,
        "content-length": String(bytes.length),
      });
      res.end(Buffer.from(bytes));
      return;
    }
    if (url.pathname === "/export-stall.xlsx") {
      // Headers, no body, never ends: a download that starts and never completes.
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${FIXTURE_EXPORT_NAME}"`,
      });
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page(url.searchParams));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    exportsServed: () => served,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

/** The fixture workflow. Every selector names a control on the fixture page above. */
export function fixtureWorkflow(entryUrl: string, overrides: Partial<ExportWorkflow> = {}): ExportWorkflow {
  return {
    ref: { id: "fixture-review-export", version: 1 },
    entryUrl,
    authSignals: ["#login-form"],
    identity: { selector: "#store-name", read: "TEXT" },
    steps: [
      { kind: "FILL", selector: "#start", value: REQUIRED_START_TOKEN, stage: "SCOPE" },
      { kind: "FILL", selector: "#end", value: REQUIRED_END_TOKEN, stage: "SCOPE" },
      { kind: "CLICK", selector: "#apply", stage: "SCOPE" },
      { kind: "WAIT_FOR", selector: "#applied:not(:empty)", stage: "SCOPE" },
    ],
    scopeReadback: { start: "#start", end: "#end" },
    exportSelector: ".export",
    downloadTimeoutMs: 15_000,
    stepTimeoutMs: 5_000,
    ...overrides,
  };
}
