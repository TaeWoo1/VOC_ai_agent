import type { ReactElement } from "react";

/**
 * Inline-SVG icon set for the navigation and section headers (replaces the emoji
 * that read inconsistently across platforms). Stroke-based, 24×24, `currentColor`
 * so a parent's text color drives the icon. Icons are decorative — rendered
 * `aria-hidden`, the adjacent text label carries the accessible name.
 *
 * One entry per icon in {@link NAV_ICON_PATHS}; {@link NavIcon} dispatches by name
 * with a safe neutral fallback, so an unknown key renders a dot — never a crash or
 * a raw string leaking into the UI (mirrors the copy-key fallback convention).
 */
const NAV_ICON_PATHS: Record<string, ReactElement> = {
  home: (
    <>
      <path d="M3 10.5 12 4l9 6.5" />
      <path d="M5 9.5V19a1 1 0 0 0 1 1h4v-5h4v5h4a1 1 0 0 0 1-1V9.5" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 13h4l1.5 3h5L16 13h4" />
      <path d="M4 13 6 5h12l2 8v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </>
  ),
  orders: (
    <>
      <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" />
      <path d="M3 7.5 12 12l9-4.5" />
      <path d="M12 12v9" />
    </>
  ),
  issue: (
    <>
      <path d="M12 4 2.5 20h19z" />
      <path d="M12 10v4" />
      <path d="M12 17.5h.01" />
    </>
  ),
  review: (
    <>
      <path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
      <path d="m8.5 10.5 2 2 4-4" />
    </>
  ),
  report: (
    <>
      <path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v4h4" />
      <path d="M8.5 13h7M8.5 16.5h7" />
    </>
  ),
  link: (
    <>
      <path d="M9 15 15 9" />
      <path d="M11 7.5 12.5 6a3.5 3.5 0 0 1 5 5l-1.5 1.5" />
      <path d="M13 16.5 11.5 18a3.5 3.5 0 0 1-5-5L8 11.5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15V4" />
      <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
      <path d="M5 15v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3" />
    </>
  ),
  bell: (
    <>
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6z" />
      <path d="M10.5 19a1.5 1.5 0 0 0 3 0" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </>
  ),
  // Customer-operations memory: an archive of what has already been seen, not a warning.
  memory: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M3.5 9.5h17" />
      <path d="M9.5 13.5h5" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h9M17 7h3" />
      <path d="M4 12h3M11 12h9" />
      <path d="M4 17h9M17 17h3" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="15" cy="17" r="2" />
    </>
  ),
  agent: (
    <>
      <rect x="5" y="8" width="14" height="10" rx="2" />
      <path d="M12 4v4" />
      <path d="M12 4h.01" />
      <path d="M9.5 12.5h.01M14.5 12.5h.01" />
      <path d="M3 12v3M21 12v3" />
    </>
  ),
};

/** The set of known icon keys — lets callers (and tests) validate that a name resolves. */
export const NAV_ICON_NAMES = Object.keys(NAV_ICON_PATHS);

/** True when `name` maps to a real icon (vs. the neutral fallback). */
export function isNavIconName(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(NAV_ICON_PATHS, name);
}

/** Render a decorative nav/section icon by key. Unknown keys render a neutral dot. */
export function NavIcon({ name, className }: { name: string; className?: string }) {
  const inner = NAV_ICON_PATHS[name] ?? <circle cx="12" cy="12" r="3" />;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ?? "h-5 w-5"}
    >
      {inner}
    </svg>
  );
}
