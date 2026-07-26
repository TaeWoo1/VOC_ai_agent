/**
 * **NAVER acquisition adapter — the named binding from the supervisor's adapter id to the existing engine.**
 *
 * The acquisition supervisor (`./acquisition-supervisor`) selects a sanitized adapter id
 * (`NAVER_ACTION_WINDOW_IMPORT`). This module is the one place that id becomes a concrete driver — and it does
 * so by **composing the existing, live-proven NAVER engine unchanged**, never re-deriving it:
 *
 *  - `NaverLiveProbeDriver` (`./naver-live-driver`) — the live-proven export-wording / consent-race / download
 *    / ingest core.
 *  - `NaverLiveImportDriver` (`./initial-import/naver-live-import-driver`) — the `ImportProbeDriver` that adds
 *    only the date-range surface and composes the probe driver.
 *
 * The factory returns exactly `new NaverLiveImportDriver(proven, opts)`. There is deliberately NO export
 * wording, consent matching, frame resolution, or session logic in this file — that all stays in the engine,
 * so this adapter cannot drift from what a live run proved. A source guard pins that (it must import the
 * engine and must not redefine its constants).
 *
 * ## Wiring status (deliberate boundary)
 *
 * The composition root (`cli/local-agent.ts` → `buildInitialImportConfig`) now calls this factory to bind the
 * supervisor's `NAVER_ACTION_WINDOW_IMPORT` id to the concrete engine — replacing the direct
 * `new NaverLiveImportDriver(...)` it used before. Because it imports the live driver, it is still never pulled
 * into the offline unit tests; it is checked by `tsc` and read by a source guard. Actually *running* this
 * driver reaches a real marketplace session and remains a separately-approved live step — binding the id to the
 * engine is not the same as taking a live run.
 */
import type { ImportProbeDriver } from "./initial-import/import-driver";
import {
  NaverLiveImportDriver,
  type NaverLiveImportDriverOptions,
} from "./initial-import/naver-live-import-driver";
import type { NaverLiveProbeDriver } from "./naver-live-driver";

/**
 * Bind the supervisor's `NAVER_ACTION_WINDOW_IMPORT` id to the existing engine: wrap the live-proven
 * `NaverLiveProbeDriver` in the existing `NaverLiveImportDriver`, unchanged. The proven driver (which alone
 * holds the page/frame and every DOM decision) is supplied by the approval-gated boot, exactly as it is today.
 */
export function createNaverActionWindowImportDriver(
  proven: NaverLiveProbeDriver,
  opts: NaverLiveImportDriverOptions = {},
): ImportProbeDriver {
  return new NaverLiveImportDriver(proven, opts);
}
