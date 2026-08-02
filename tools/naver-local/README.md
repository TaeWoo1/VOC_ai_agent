# tools/naver-local — NAVER guided-connection walkthrough scaffolding

Disposable local scaffolding for the **NAVER API order-connection** guided walkthrough. Every run is bound
to a per-bootstrap **walkthroughRunId** so the operator's actual browser tab is provably talking to the
exact bootstrapped frontend/backend/DB/runtime — not a stale tab or a different environment (a green
`/health` is never mistaken for a working, correctly-targeted walkthrough). The preflight ends in a real
clean-context browser run and fails closed on any mismatch.

**The NAVER order connection needs NO Local Agent.** These scripts stand up the backend + frontend for the
browser walkthrough only. Nothing here calls the NAVER API, enters a credential, or runs a sync — those are
separate, operator-approved actions performed in the browser.

## Single-run contract (fixed for the whole walkthrough)

- **Frontend origin = `http://localhost:5173`** — the ONLY origin the backend CORS allows. `127.0.0.1:5173`
  is rejected and must not be used.
- **Backend origin = `http://127.0.0.1:18090`** (fixed port). Same-origin `/api` Vite proxy only.
- **`VITE_API_BASE_URL` must be UNSET** in every dev env file. The preflight does not auto-edit `.env.local`.
- **One run identity.** `bootstrap.sh` mints a `walkthroughRunId` shared by backend + frontend + preflight;
  the operator opens exactly `…/connect/naver?walkthroughRun=<id>`. Changing code/ports/branch invalidates
  the run — re-bootstrap.

## One-time setup

Store the disposable vault master key in the Keychain (never in the repo):

```
security add-generic-password -s sellerops-vault-master-key -a naver-walk-1 -w "$(openssl rand -base64 32)"
```

Create a disposable Postgres database on port 55432 named `naver_walkthrough`. Never point at real
sellerops (`:5432/sellerops`).

## Server steps (operator runs these; Claude does not run live)

1. **Bootstrap** — mint the run identity (writes `.run/current.env`, prints the operator URL):
   ```
   tools/naver-local/bootstrap.sh
   ```
2. **Backend** (fixed :18090, NAVER on, scheduler off, walkthrough mode + run id from `.run/current.env`):
   ```
   tools/naver-local/run-backend-local.sh
   ```
3. **Frontend** (walkthrough mode + run id injected, `/api` proxy pinned to :18090; opens at `localhost:5173`):
   ```
   tools/naver-local/run-frontend-local.sh
   ```
4. **Preflight** — run BEFORE opening the browser; it must print `PREFLIGHT PASS` and echo exactly one URL:
   ```
   SELLEROPS_COLLECT_SCHEDULER_ENABLED=false SELLEROPS_CONNECTOR_NAVER_ENABLED=true \
   PGPORT=55432 PGDATABASE=naver_walkthrough \
   tools/naver-local/preflight.sh
   ```

## What preflight checks (all must PASS; the browser run is the final gate)

Approved origin (`localhost:5173`) · backend `/health` · `/api` proxy reachable · no absolute
`VITE_API_BASE_URL` · proxy target == backend · disposable DB · scheduler OFF · NAVER flag ON · pristine
baseline · **git unchanged since bootstrap** · **backend `/context` run id + git match the bootstrap** ·
**env-binding browser run** (`env-binding-smoke.mjs`: clean context opens the exact URL → disposable banner
shows the run id → wizard reachable, with 0 NAVER calls) · **page load wrote 0 DB rows**. It writes a
sanitized runtime manifest (`$SELLEROPS_MANIFEST_OUT`, default a temp file): run id, git, origins, DB alias,
scheduler, NAVER flag, baseline counts, smoke result — no secret/token/credential/NAVER value.

## Phase-specific operator entrypoint

The operator's action after approval depends on the **phase**, and the preflight prints only the one true action:

- **Guided order connection** (default, no `SELLEROPS_APPROVAL_PHASE`) → the operator opens the bound
  `http://localhost:5173/connect/naver?walkthroughRun=<id>` URL. This is the ONLY phase that prints a frontend URL.
- **Calibration phases** (`SELLEROPS_APPROVAL_PHASE=API_CENTER_STRUCTURE_OBSERVATION`,
  `API_ISSUANCE_HIGHLIGHT_PROOF`, or `API_CENTER_VISUAL_RECON`) → the operator action is a **CLI-launched
  dedicated Chrome window** that SellerOps opens on approval; there is **no frontend URL**. The preflight prints
  the dedicated-window action instead, and the manifest carries
  `entrypointType`/`entrypointCommandId`/`operatorActionSummary`. A manifest whose phase and entrypoint disagree
  fails BEFORE it is emitted. The **visual-recon** phase additionally carries `captureScreens` (the fixed screen
  set), `artifactCategory` (the gitignored `.calibration/visual/` sink), and the `screenshotPolicy` /
  `structuralSummaryPolicy` (redacted viewport + sanitized closed-vocabulary only), and its driver is
  `capture-api-center-visual` — never the hotkey calibrator.

## API-center Visual Recon (redacted-screenshot calibration)

An alternative to the hotkey selector calibrator (`calibrate-api-center`). Instead of the operator hovering one
element and pressing a hotkey, SellerOps captures a **redacted screenshot** of each API-center screen the
operator navigated to, plus a sanitized structural summary, and a HUMAN reviewer reads that redacted image to
identify controls and later propose selector candidates. It is a first-class approval **phase**
(`SELLEROPS_APPROVAL_PHASE=API_CENTER_VISUAL_RECON`), so the same preflight gate prepares a sanitized PREPARED
manifest for it (driver `capture-api-center-visual`, the four capture screens, the gitignored sink, and the
redacted-viewport / sanitized-summary policies) — the run stays fully gated, never adopts a selector, and never
flips `SELECTORS_CALIBRATED`. Live entry (gated, human-attended):

```
set -a && . ./.env && set +a          # NAVER_API_CENTER_URL (operator-owned; never logged)
npx tsx collector/src/cli/capture-api-center-visual.ts -- --i-understand-this-opens-live-naver
npx tsx collector/src/cli/capture-api-center-visual.ts -- --cleanup   # delete recon artifacts, launch nothing
```

Per screen the operator navigates manually and signals `ready`; the tool then, **fail-closed**:

1. **Redacts first.** Opaque overlays are drawn over every sensitive region in every frame — form-field values,
   password/readonly/`code`/`pre`, credential (Client ID / Application ID / Secret) areas, copy-linked value
   boxes, stray identity text (email / account / store id), and the site header/footer chrome. Fixed UI labels
   are deliberately left visible so the reviewer can still read the layout.
2. **Verifies coverage.** Every detected sensitive element must be covered by an intact opaque overlay (checked
   per category, per frame). Any uncovered element, integrity failure, or malformed report ⇒ **HALT, no
   screenshot** for that screen.
3. **Only then screenshots** the already-redacted viewport (to a buffer, no auto-write), re-verifies the
   overlays still hold, and discards the image if they regressed.

**What the reviewer sees** (gitignored `collector/.calibration/visual/`): the redacted PNG + a sanitized JSON
summary (closed-vocab control roles, coarse bounding-box buckets, sibling position, ancestry tag chain,
presence booleans, structural hashes, integer redaction counts, page category). **Never** a raw selector,
attribute value, element text, field value, credential string, or raw URL. The Client ID/Secret value stays
hidden even from the reviewer; only the credential *section/label/control position* may ever be identified.

Selector adoption stays a separate, explicitly-authorized step (`SELECTORS_CALIBRATED` is not flipped by this
tool): a proposed selector is eligible only when the screenshot target and structural candidate are the same
control, it matches exactly one element, it does not depend on an account/credential value, it is not
position-only, and any text it uses is a fixed UI label.

## Regression self-check

`preflight-selfcheck.sh` proves the gate + binding fail closed (requires bootstrap + backend + frontend up):

```
tools/naver-local/preflight-selfcheck.sh
```

Cases: `WRONG_HOST` / `STALE_OVERRIDE` / `WRONG_PROXY` / `BAD_LOGIN` → FAIL; `ENV_BINDING_WRONG` /
`ENV_BINDING_MISSING` (a wrong/absent URL run id) → blocked at the mismatch screen; `NORMAL` → PASS with 0
NAVER calls.

## Operator vs server boundary

- **Server steps** (above): bootstrap, start backend, start frontend, run preflight (incl. the clean-context
  browser run — a throwaway browser context, not the operator's browser). No live NAVER contact.
- **Operator steps** (browser, after a fresh single-use approval): open the exact
  `http://localhost:5173/connect/naver?walkthroughRun=<id>` the preflight printed (fresh window). The
  disposable banner's run id must match the CLI. Enter the real Application ID/Secret in the masked field,
  run the one connection test, run the one first `ORDER_SUMMARY` sync. The credential is typed only into the
  UI — never printed, never written to a file, never passed on a CLI.
