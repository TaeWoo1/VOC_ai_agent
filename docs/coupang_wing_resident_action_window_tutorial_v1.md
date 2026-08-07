# Coupang WING-Resident Action Window Tutorial v1

**Status:** OFFLINE-PROVEN (hermetic + real-DOM browser E2E). Real WING live = deferred to a separate
fresh-approval unit. **No contract change, no migration, no backend change.**

## Why (the UX this replaces)

The prior Coupang guided walkthrough was a **dual-window remote control**: the seller pressed a
step-by-step "다음" in the SellerOps FE, which advanced the run, which re-highlighted the next control in
the WING window — SellerOps FE ⇄ WING ping-pong. A live rehearsal confirmed the plumbing (bridge / binding
/ pairing) but the product path was rejected: the seller's attention bounces between two windows every step.

**Desired UX:** one SellerOps CTA → the Local Agent opens WING → the API-issuance walk proceeds almost
entirely inside a **WING-resident overlay** (highlight + guidance + advance button drawn ON the WING page).
The seller's primary screen stays WING; the FE handles only start, agent status/recovery, and the return to
credential entry.

## Design — relocate & reuse (no new bridge protocol)

The on-page overlay primitive already existed (`overlay.ts::mountOverlay` — a `pointer-events:none` spotlight
ring + badge, shared with the NAVER issuance driver), and the engine already modelled observe-then-advance
(`{ observe: target }` → `onUserActionObserved`). The whole shift is a **relocate**, entirely within the
existing v2 protocol:

| Concern | Before (dual-window) | After (WING-resident) |
| --- | --- | --- |
| Per-step guidance copy | SellerOps FE panel | **WING overlay panel** (product copy on the page) |
| Step advance (form-fill / 발급 / copy / return) | FE `REQUEST_STEP_RECHECK` ("다음") | **WING overlay "다음" button** — driver observes a value-free press latch |
| Step advance (reach open-API page) | FE `REQUEST_STEP_RECHECK` | value-free **page-category transition** (already existed) |
| FE role | step-by-step controller | **start + status/recovery + credential return** |
| `REQUEST_STEP_RECHECK` | primary driver | **fallback / recovery only** (park re-probe/re-guide) |

Advance model per step: `reach_open_api` auto-advances on the observed `wing_home → open_api_issuance`
navigation; every same-page checkpoint (자체개발 / 업체명 / 호출 IP / 발급 / copy keys / return) advances when
the seller presses that step's **WING-resident overlay button** and the driver observes it. `발급` stays an
explicit human checkpoint: the button is highlighted, the run rests, the seller issues the key themselves.

## Changes

- **`collector/src/action-window/overlay.ts`** — an explicit `residentPanel` opt-in draws a fixed-position
  guidance panel (product copy + an optional `advance` button, `pointer-events:auto`) SEPARATE from the ring
  (which stays `pointer-events:none`). A click copies the step's opaque in-page token into a latch; helpers
  `resetOverlayAdvance` / `readOverlayAdvancePressed` re-arm and read it value-free. The panel is gated on the
  explicit opt-in, **never inferred from `label`**, so every other caller (NAVER review export / NAVER issuance
  / Coupang renewal — all of which pass a diagnostic `label`) keeps the classic ring+badge and is unchanged
  (locked by a RUN_INTEGRATION regression test).
- **`collector/src/action-window/coupang-wing-issuance-driver.ts`** — the overlay copy is now the product
  guidance (references the on-page button, not "SellerOps에서 다음"); `mountStepOverlay` passes the advance
  affordance for checkpoints; `armObserve` re-arms the latch; `observeUserAction` polls the value-free latch
  (checkpoints) or the page-category transition (`reach_open_api`). Still no `.value`/`.getAttribute`/`.click`/
  `.screenshot` — the 168 + 75 source guards stay green.
- **`collector/src/action-window/coupang-issuance/coupang-issuance-engine.ts`** — two surgical edits:
  `onTargetHighlighted` arms an observation at checkpoints (`{ observe }`); `onUserActionObserved` advances the
  checkpoint on the observed on-page press. `REQUEST_STEP_RECHECK` remains valid as fallback/recovery.
- **`frontend/.../CoupangIssuanceGuidedWalkthrough.tsx`** — sheds the per-step timeline / step-detail / recheck
  control. A healthy barrier shows STATUS ONLY ("쿠팡(윙) 창에서 화면 안내를 따라 진행하세요" + progress);
  a recoverable blocker surfaces the recovery control ("다시 확인" = `REQUEST_STEP_RECHECK`) + 취소; COMPLETED
  keeps the return CTA → `onIssued`. Start CTA, pairing/status/recovery, and text fallback are unchanged.

## Offline E2E proof (the completion criterion)

**"SellerOps CTA once → WING open → issuance synthetic walkthrough via WING overlay only → SellerOps return."**

- **Hermetic (`npm test`, no browser):** the bridge lifecycle E2E over the real loopback socket drives the
  full walk to COMPLETED from a **single START_RUN** — every step advances on the fixture's WING-resident
  press, and the FE sends **zero `REQUEST_STEP_RECHECK`** (`commandResults` length = 1). Engine / session /
  stages / guards all green. Full collector suite: **7008 passed, 17 skipped**.
- **Real DOM (`RUN_INTEGRATION=1`, headless Chromium on a SYNTHETIC page served at a wing.coupang.com URL via
  `page.route` — no network, no live WING, no approval):** a real click on the WING-resident overlay button
  flips the value-free latch (false→true), reset re-arms per step, unmount clears; the ring stays
  `pointer-events:none`; and the **full guided walk completes driven only by real on-page button clicks** —
  a single START_RUN, no FE 다음. (3 passed.)
- **Frontend suite:** 1877 passed (component reduced to start + status/recovery + return).

## Safety

- Value-free throughout: the overlay latch is an opaque per-step token compared for equality; the driver reads
  no Access Key / Secret Key / 업체코드 value, no DOM text, no attribute, no clipboard, no screenshot. The 168
  pure-runtime + 75 live-driver source guards are unchanged and green.
- The overlay advance button is the agent's OWN control (the seller presses it to advance guidance) — never a
  hidden or chained platform click; the seller still performs every real WING act (login, 발급, copy) themselves.
- No credential entry, no 발급/재발급/삭제 automation, no order/shipping/product write, no contract, no migration.

## Not yet done (deferred)

The real WING live walk (a seller driving a real WING page end-to-end via the overlay) is a **separate
fresh-approval unit** — the driver's fixed-label highlight selectors remain `LIVE_DOM_CALIBRATION_PENDING`
until a live walk confirms each resolves uniquely on the real WING DOM.
