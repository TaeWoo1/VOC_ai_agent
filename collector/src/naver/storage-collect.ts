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

/** Read storage key names + value LENGTHS inside the page; values never leave it. */
async function readDomStorage(page: Page): Promise<RawDomStorage> {
  return page.evaluate(async () => {
    const dump = (s: Storage): Array<{ key: string; valueLength: number }> => {
      const out: Array<{ key: string; valueLength: number }> = [];
      for (let i = 0; i < s.length; i += 1) {
        const key = s.key(i);
        if (key === null) continue;
        const value = s.getItem(key);
        out.push({ key, valueLength: value ? value.length : 0 });
      }
      return out;
    };
    let idb: string[] = [];
    try {
      const dbApi = indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> };
      if (typeof dbApi.databases === "function") {
        const dbs = await dbApi.databases();
        idb = dbs.map((d) => d.name ?? "").filter((n) => n.length > 0);
      }
    } catch {
      idb = [];
    }
    return { local: dump(localStorage), session: dump(sessionStorage), idb };
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
