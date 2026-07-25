# Live CTA E2E runbook — 과거 리뷰 전체 연동, discovery → 1 segment

The open item after 2026-07-25: prove the seller's OWN path live. Everything here has been rehearsed offline
against a real socket (`collector/test/crossstack/fe-import-runtime-real-bridge.test.ts`); what a live run adds
is the one thing a fixture cannot — that the real NAVER surface answers the discovery bounds read, and that a
seller pressing one button in SellerOps reaches an ingested month.

**This run requires a fresh, single-use, in-turn approval and a seated operator.** A plan is never
authorization. The operator performs every marketplace click; the runtime only detects, highlights, observes.

## Preconditions

| | |
|---|---|
| Backend | disposable, name-guarded `sellerops_riv_live_*`, V27/V28 applied, on `127.0.0.1:18090`. Never the persistent `sellerops`. |
| Seed | one org/user, one NAVER seller account in `CONNECTED` — the card needs an `accountId` for the discovery launch. |
| Frontend | `VITE_API_BASE_URL=http://127.0.0.1:18090 npm run dev` on `:5173` (an allowed bridge origin by default). |
| Agent | `npx tsx src/cli/local-agent.ts --action-window-initial-review-import --i-understand-this-opens-live-naver` with `NAVER_REVIEW_URL` set. Bridge on `47615`. |
| Pairing | the agent shows the approval code through its own human channel (macOS: a native dialog). Approve it from the SellerOps UI's connection flow. |
| Login | the operator logs into NAVER themselves, in the browser the agent opened. |

### Three harness facts that each cost a wrong diagnosis on the first attempt

1. **Browse `http://localhost:5173`, not `127.0.0.1:5173`.** The backend allows exactly ONE CORS origin
   (`sellerops.cors.origin`, default `http://localhost:5173`), so the other spelling fails the preflight with
   403 — and the login form reports any failure as 이메일 또는 비밀번호를 확인해 주세요, which reads as bad
   credentials.
2. **The pairing UI is behind `VITE_ENABLE_AGENT_BRIDGE=true`.** `BridgeStatus` is the only surface with a
   연결하기 button, and `AppShell` mounts it only under that opt-in flag. Without it there is no way for a
   seller to pair the agent the guided import requires — a real gap in the product path, not just a dev
   inconvenience.
3. **`dev_tty_stderr` needs a real TTY.** Under a harness that redirects stderr the approval presenter has no
   human channel, so the bridge correctly refuses to pair (`bridge_pair_refused approval_unavailable`). Running
   the agent from an interactive terminal is the honest fix; `--dev-insecure-auto-approve` bypasses the
   out-of-band approval and any run that uses it must say so — that control is then NOT exercised.

## The run

1. **Press 과거 리뷰 전체 연동하기.** No plan exists, so the card attaches to the import carrier, mints a
   DISCOVERY ticket, and sends `START_RUN`. Expect step 1/5 then 2/5.
2. **Bounds read.** Predicted `UNREADABLE` — the surface's date inputs are calendar-backed text fields with no
   `min`/`max`. If so the card asks for the earliest selectable date (3/5) and the latest (4/5), and the
   evidence recorded will be `OPERATOR_CONFIRMED`. If the bounds ARE readable, both steps report `SKIPPED` and
   the evidence is `MACHINE_DISCOVERED` — record which happened; it is the run's first real finding.
3. **The plan appears.** Step 5/5 reports the range, the backend creates the monthly segments, and the card
   re-reads the plan: 진행 shows `n개 구간 중 0개 완료` and 가져올 수 있는 기간 shows what discovery found.
4. **Press 계속 가져오기 (ONE segment only).** A SEGMENT ticket, then the eight-step guided export: the card
   names the required window, the runtime highlights start date → end date → export → NAVER's own `확인`, and
   the operator clicks each one.
5. **Stop after that segment completes.** The bounded-proof limit is unchanged.

## What must be true afterwards

- attempt `SUCCEEDED` with a row count from the backend, segment `COMPLETED` + `COVERED`, both tickets
  `CONSUMED`; the plan's `range_evidence` is whatever discovery actually established, never upgraded.
- No launch ref, date, filename, path or URL in any log or wire frame.
- Every marketplace click attributable to the operator.

## If it stops

Read the card, not the terminal: a blocker is now rendered with its repair (`SCOPE_MISMATCH` → 날짜를 다시
선택). Fix the screen and press 다시 확인 — that is `REQUEST_STEP_RECHECK`, and it re-checks rather than
completes. On a fail-closed stop, report sanitized structure only (counts, booleans, enums) and the next fix;
do not widen a selector without evidence and never click for the seller.

## Teardown

Stop the agent (SIGINT — it closes the bridge and the browser once), confirm the port is closed, drop the
disposable database under its name guard with `sellerops` surviving, and keep `collector/.profile/naver` (the
login profile is gitignored and worth keeping). `collector/.import-runs/` markers are gitignored; they carry no
ref, date or path.
