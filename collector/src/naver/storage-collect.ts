import type { BrowserContext, Page } from "playwright";
import {
  extractStorageSignals,
  type ContextLabel,
  type SanitizedStorageSignals,
} from "./storage-probe";

/**
 * Live boundary for the storage diagnostic — reads the browser storage of an
 * already-loaded page/context and hands a RAW snapshot to the PURE
 * `extractStorageSignals`, which sanitizes it. This module never prints anything
 * and never returns a raw value:
 *
 *  - localStorage / sessionStorage: read INSIDE the page; only the key name and
 *    the value's `.length` are returned — the value itself never leaves the page.
 *  - cookies: read via `context.cookies()` (so httpOnly cookies are visible);
 *    only the name, the value's `.length`, the domain, and the flags are passed
 *    on — the cookie value is never forwarded.
 *  - IndexedDB: only database NAMES (via `indexedDB.databases()`), never contents.
 *
 * It performs NO click, NO navigation, NO download, NO upload, and writes NO
 * status — it is a read-only metadata gather. The no-leak guarantee is proven by
 * the hostile-fixture test on `extractStorageSignals`.
 */

interface RawDomStorage {
  local: Array<{ key: string; valueLength: number }>;
  session: Array<{ key: string; valueLength: number }>;
  idb: string[];
}

/**
 * Read storage key names + value LENGTHS inside the page; values never leave it.
 *
 * IMPORTANT (no named inner functions): the evaluate callback is serialized and run
 * in the page sandbox, so it must contain NO named inner helper (`const dump = …` /
 * `function dump …`). Under tsx/esbuild `keepNames` such a helper is rewritten to
 * `__name(…)`, whose helper is NOT defined in the page → `ReferenceError: __name is
 * not defined` at runtime. The enumeration is therefore inlined with plain loops and
 * no inner declarations. A source-guard test locks this shape.
 */
async function readDomStorage(page: Page): Promise<RawDomStorage> {
  return page.evaluate(async () => {
    const local: Array<{ key: string; valueLength: number }> = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key === null) continue;
      const value = localStorage.getItem(key);
      local.push({ key, valueLength: value ? value.length : 0 });
    }
    const session: Array<{ key: string; valueLength: number }> = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key === null) continue;
      const value = sessionStorage.getItem(key);
      session.push({ key, valueLength: value ? value.length : 0 });
    }
    const idb: string[] = [];
    try {
      const dbApi = indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> };
      if (typeof dbApi.databases === "function") {
        const dbs = await dbApi.databases();
        for (const d of dbs) {
          const name = d.name ?? "";
          if (name.length > 0) idb.push(name);
        }
      }
    } catch {
      /* databases() unsupported/blocked → leave idb empty */
    }
    return { local, session, idb };
  });
}

/**
 * Gather a SANITIZED storage snapshot for one context label. Reads cookies
 * (incl. httpOnly) via `context.cookies()` and DOM storage via `readDomStorage`,
 * forwarding only name + value LENGTH + flags + domain to the pure sanitizer.
 */
export async function collectSanitizedStorage(
  page: Page,
  ctx: BrowserContext,
  opts: { contextLabel: ContextLabel; salt: string },
): Promise<SanitizedStorageSignals> {
  const dom = await readDomStorage(page);
  const rawCookies = await ctx.cookies();
  return extractStorageSignals({
    contextLabel: opts.contextLabel,
    originUrl: page.url(),
    salt: opts.salt,
    // Forward ONLY metadata: name, value LENGTH (never the value), domain, flags.
    cookies: rawCookies.map((c) => ({
      name: c.name,
      valueLength: c.value.length,
      domain: c.domain,
      httpOnly: c.httpOnly,
      secure: c.secure,
      expires: c.expires,
    })),
    localStorage: dom.local,
    sessionStorage: dom.session,
    indexedDbNames: dom.idb,
  });
}
