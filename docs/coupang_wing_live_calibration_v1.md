# Coupang WING Live Calibration + Walkthrough Binding v1

> **Status:** PARTIAL LIVE PASS (observe-only), 2026-08-06/07, on branch
> `feat/coupang-wing-guided-issuance-tutorial-v1` (PR #402, **not merged**). Real Coupang WING, an
> **already-issued** account, fully sanitized, **zero secret/DOM/URL/PII capture**, **zero 발급 click**, no
> migration. This document deliberately separates what is **LIVE-PROVEN** from what remains
> **SYNTHETIC-ONLY**.

## Environment

- Backend `:18091` walkthrough-mode, channel `COUPANG`, connector-coupang on, scheduler off, disposable DB
  `coupang_wing_cal@:55432` (never `:5432`). FE `:5173` walkthrough mode. Both bound to walkthroughRun
  `run-42937aa0ad9b`. Observe-only, per-run operator grants (`apr-…`), single-use; **any post-grant code
  change revoked the grant and was followed by a fresh bootstrap + fresh "Seated and ready."** (three grants
  total across the calibration loop). Env torn down after; disposable DB kept inert.

## LIVE-PROVEN (real WING, sanitized)

1. **walkthroughRun backend binding — channel-neutral, no migration.** `GET /api/walkthrough/context`
   reported `channelCode: COUPANG`, `connectorEnabled: true`, the shared `run-42937aa0ad9b`, git commit, and a
   sanitized baseline (`count()` only). `POST /handshake` **matched** on the correct run id + origin and
   **failed closed** on a stale run id. Frontend + backend bound to the same disposable run; the read-only
   binding needs **no new table / run store / migration** (a config generalization of the NAVER mechanism).
2. **The read-only WING recorder works against real WING.** After the fault-fingerprinting hardening
   (`7656efd`) the observe-only recorder captured cleanly on the real open-API page — 0 fault, and only a
   sanitized record crossed the boundary (per-candidate `matchCount` · role · fixed-label · opaque 16-hex
   signature + bucketized page-category signals). No selector, value, PII, raw DOM/HTML, screenshot, or raw
   URL — the raw URL is reduced to a host-category enum.
3. **Already-issued open-API page DETECTION — calibrated + live-verified.** The first capture classified the
   already-issued page as `wing_home` (the form marker was absent; the real heading text is sanitized-out, so
   it was **not** retuned speculatively). Grounded in the same run, a value-free census signal
   `credentialAnchorPresent` (an EXACT accessible-name match on the **live-confirmed** "Access Key" credential
   region — a boolean only) now identifies the page. A second, independent capture confirmed
   `pageCategory: open_api_issuance` with `credentialAnchorPresent: true`. (`c22cf38`.)
4. **Two fixed-label target anchors live-confirmed, with stable signatures across two captures:**
   `issue` (발급) `matchCount=1` (sig `d3f775e8…`) and `credentials` (Access Key) `matchCount=1`
   (sig `2b2479a8…`) — identical across both runs (deterministic).
5. ~~**Already-issued signature.** On the already-issued page the issuance-**form** controls are absent while
   the issued **keys** + the 발급 button are present — a coherent already-issued shape. This also confirms the
   scope assumption that `자체개발`/`호출 IP` are form-only and not observable on an already-issued account.~~
   **WITHDRAWN 2026-08-08 — falsified by the real no-key form.** `자체개발` and `호출 IP` matched **0 on the
   real issuance form too**, so their absence here was never evidence of form-only-ness — the labels simply
   match nothing on either surface. The "coherent already-issued shape" conclusion rested on that inference and
   does not survive it. See
   [`coupang_no_key_form_classifier_selector_recon_v1.md`](./coupang_no_key_form_classifier_selector_recon_v1.md).

## SYNTHETIC-ONLY (not live-verified this unit — honest scope)

1. **The unissued first-issuance FORM** (`자체개발` / `업체명`/URL / `호출 IP` / the pre-issue checkpoint):
   the operator's account is already issued, so this screen is **not observable**. It was **not fabricated**,
   and **no `FIRST_ISSUANCE_FORM_LIVE_PASS` is recorded**. These stay offline-synthetic-verified (the engine +
   fixture-driver tests).
2. **`vendor_info` (업체명)** matched **9×** on the real page — the label is too broad to resolve uniquely. It
   cannot be narrowed without reading page text (forbidden), so it stays `LIVE_DOM_CALIBRATION_PENDING`.
3. **`self_dev` / `call_ip`** — `matchCount=0` on the already-issued page; stay synthetic. ~~form-only
   controls~~ **corrected 2026-08-08:** they matched 0 on the real no-key **form** as well, so these are
   unresolved labels, not form-only controls. Recon candidates: `coupang-wing-label-recon.ts`.
4. **The full FE-driven guided walkthrough end-to-end** (SellerOps start → agent-hosted Action Window run →
   highlight on the real WING page → `REQUEST_STEP_RECHECK` advance → return): calibration used the read-only
   **recorder** (the driver's observation path), **not** the full guided run. The guided walkthrough remains
   offline-synthetic-verified; a live guided run is a future unit.
5. `WING_HIGHLIGHT_CALIBRATION` stays `LIVE_DOM_CALIBRATION_PENDING` overall — 2 of 5 target anchors are
   live-confirmed; the form markers and the 3 remaining anchors are not.

## Safety (honored throughout)

No 발급 click; no API key re-issue / reset / delete; no Access Key / Secret Key / 업체코드 value read; no raw
DOM / HTML / screenshot / PII / URL captured or stored (only counts / booleans / buckets / roles / fixed
candidate labels / opaque 16-hex signatures / host-category enums); no order/shipping/product write; no
migration; **PR #402 not merged**. Each live run was a single-use, per-run operator grant; every post-grant
code change was followed by a fresh bootstrap + fresh grant.

## Where this leaves PR #402

The offline-synthetic guided issuance (collector runtime + FE walkthrough) is unchanged and green. This unit
adds: the channel-neutral walkthroughRun binding (**live-proven**), the observe-only recorder + Coupang
live-approval gate (**live-exercised**), and a grounded, **live-verified** already-issued classifier
calibration. The unissued-form selectors + the full guided-walk live run remain future work.
