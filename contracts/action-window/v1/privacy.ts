// Privacy boundary for the public Action Window contract.
//
// The shared View Model, command/event payloads, and fixtures must NEVER carry
// selectors, raw DOM, frame/marketplace URLs, CDP target IDs, cookies, tokens,
// secrets, local file paths, raw account/connection IDs, browser profile paths,
// or downloaded file contents. This module makes those structurally detectable
// so tests can reject them.

import { isRecord } from "./result";

/**
 * Forbidden substrings matched against lower-cased object keys. Composite
 * identifiers only (e.g. `accountid`) — bare `id` is intentionally allowed so
 * legitimate opaque handles like `runId`, `eventId`, `commandId`, `stepId` pass.
 */
export const FORBIDDEN_KEY_SUBSTRINGS: readonly string[] = [
  // selectors / DOM
  "selector",
  "xpath",
  "queryselector",
  "cssselector",
  "innerhtml",
  "outerhtml",
  "rawhtml",
  "htmlcontent",
  "domnode",
  "domcandidate",
  // urls / frames / navigation
  "url",
  "href",
  "endpoint",
  "frameurl",
  "frameid",
  // CDP / automation internals
  "cdp",
  "targetid",
  "sessionid",
  "devtools",
  // credentials / secrets
  "cookie",
  "token",
  "secret",
  "password",
  "passwd",
  "credential",
  "authorization",
  "bearer",
  "jwt",
  "apikey",
  // raw identity
  "accountid",
  "connectionid",
  "sellerid",
  "masterid",
  "storeid",
  "userid",
  "loginid",
  // filesystem / profile
  "filepath",
  "profilepath",
  "profiledir",
  "abspath",
  "localpath",
  "dirpath",
  "downloaddir",
  // raw artifact bytes / content
  "filecontent",
  "filebytes",
  "downloadcontent",
  "rawbytes",
  "screenshot",
];

/** Value-level patterns that indicate a leaked URL, scheme, or absolute path. */
const FORBIDDEN_VALUE_PATTERNS: readonly RegExp[] = [
  /:\/\//, // any scheme://  (http, https, ws, file, chrome-devtools, …)
  /^[A-Za-z]:\\/, // windows drive path  C:\...
  /(^|\s)\/(?:Users|home|var|tmp|private|etc|Applications)\//, // unix absolute path
];

function keyIsForbidden(key: string): boolean {
  const k = key.toLowerCase();
  for (const sub of FORBIDDEN_KEY_SUBSTRINGS) {
    if (k.includes(sub)) return true;
  }
  return false;
}

function valueIsForbidden(value: string): boolean {
  for (const re of FORBIDDEN_VALUE_PATTERNS) {
    if (re.test(value)) return true;
  }
  return false;
}

/**
 * Walk an arbitrary value and return the paths of every field that violates the
 * privacy boundary (forbidden key name, or a string value that looks like a URL /
 * scheme / absolute path). Empty array ⇒ sanitized.
 */
export function findForbiddenFields(value: unknown, basePath = ""): string[] {
  const issues: string[] = [];
  walk(value, basePath, issues);
  return issues;
}

function walk(value: unknown, path: string, issues: string[]): void {
  if (typeof value === "string") {
    if (valueIsForbidden(value)) issues.push(path || "(root)");
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      walk(value[i], `${path}[${i}]`, issues);
    }
    return;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (keyIsForbidden(key)) issues.push(childPath);
      walk(child, childPath, issues);
    }
  }
}

export function isSanitized(value: unknown): boolean {
  return findForbiddenFields(value).length === 0;
}

export function assertNoForbiddenFields(value: unknown): void {
  const violations = findForbiddenFields(value);
  if (violations.length > 0) {
    // Report only the paths (field names), never the offending values.
    throw new Error(`Privacy boundary violated at: ${violations.join(", ")}`);
  }
}
