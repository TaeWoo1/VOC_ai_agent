// Action Window protocol identity, version, and compatibility rule.

export const PROTOCOL_NAME = "sellerops.action-window" as const;

/** Current protocol semantic version. */
export const PROTOCOL_VERSION = "1.0.0" as const;

/** Exact versions this build is known to speak. */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = ["1.0.0"];

export type SemVer = { major: number; minor: number; patch: number };

export function parseVersion(v: string): SemVer | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) return null;
  return {
    major: Number(m[1] ?? "0"),
    minor: Number(m[2] ?? "0"),
    patch: Number(m[3] ?? "0"),
  };
}

const CURRENT: SemVer = parseVersion(PROTOCOL_VERSION) ?? { major: 1, minor: 0, patch: 0 };

/** True only for an exact known version string. */
export function isSupportedProtocolVersion(v: string): boolean {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(v);
}

/**
 * Compatibility rule (fail-closed): a message is compatible only when its MAJOR
 * equals the current major AND its MINOR does not exceed the current minor. A
 * consumer refuses a newer minor it does not understand, and any different major.
 * Patch differences are ignored.
 */
export function isCompatibleProtocolVersion(v: string): boolean {
  const p = parseVersion(v);
  if (!p) return false;
  return p.major === CURRENT.major && p.minor <= CURRENT.minor;
}

export function assertProtocolVersion(v: string): void {
  if (!isCompatibleProtocolVersion(v)) {
    // Fail closed without echoing the raw value.
    throw new Error("Unsupported Action Window protocol version (fail-closed).");
  }
}
