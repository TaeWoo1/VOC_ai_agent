# Live CTA E2E runbook — 과거 리뷰 전체 연동, discovery → 1 segment

**Ran once, on 2026-07-25** (discovery → 37-segment plan → segment 1, 61 rows; results and analysis in
`naver-initial-review-import-live-proof-record.md` Addendum 2). Kept as the repeatable procedure for the runs
still owed — more than one segment, an apply-requiring surface, the segment `UNREADABLE` branch — and for the
next person, who should not have to rediscover the five traps below.

Everything here is also rehearsed offline against a real socket
(`collector/test/crossstack/fe-import-runtime-real-bridge.test.ts`); a live run adds the one thing a fixture
cannot — how the real NAVER surface answers, and that a seller pressing one button reaches an ingested month.

**This run requires a fresh, single-use, in-turn approval and a seated operator.** A plan is never
authorization. The operator performs every marketplace click; the runtime only detects, highlights, observes.

## Preconditions

| | |
|---|---|
| Backend | disposable, name-guarded `sellerops_riv_live_*`, V27/V28 applied, on `127.0.0.1:18090`. Never the persistent `sellerops`. |
| Seed | one org/user + one NAVER seller account in `CONNECTED` — the card needs an `accountId`. `POST /api/auth/signup` → `GET /api/channels` (take the `NAVER` id) → `POST /api/seller-accounts/file-channel {channelId, alias}`. That endpoint sets `CONNECTED` + `fileUpload`, which is all the card reads. |
| Frontend | `frontend/.env.local` (gitignored) with `VITE_API_BASE_URL`, `VITE_ENABLE_AGENT_BRIDGE=true`, `VITE_BRIDGE_URL`; then `npm run dev` on `:5173`. |
| Agent | `npx tsx src/cli/local-agent.ts --action-window-initial-review-import --i-understand-this-opens-live-naver`, with `NAVER_REVIEW_URL` and `SELLEROPS_BASE_URL`/`_EMAIL`/`_PASSWORD` pointed at the disposable backend. Bridge on `47615`. |
| Pairing | the agent shows the approval code through its own human channel (macOS production: a native dialog; DEV: its stderr — see trap 3). Approve from the SellerOps 연결하기 panel. |
| Login | the operator logs into NAVER themselves, in the browser the agent opened. The profile persists, so an agent restart does not cost another login. |

### Five traps, each of which cost a wrong diagnosis on the 2026-07-25 run

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
4. **A shell-passed `VITE_API_BASE_URL` does not reach the browser.** `VITE_… npm run dev` left the bundle on
   the `http://localhost:8080` default; the value has to be in `frontend/.env.local`. Verify before involving
   the operator: `curl -s http://localhost:5173/src/lib/apiClient.ts | grep 18090`.
5. **Stopping the agent means signalling the NODE process, not the `npx tsx` wrapper.** `pgrep -f local-agent`
   finds the wrapper, and SIGINT there leaves the bridge listening and Chromium open. Take the pid off the
   listening port instead: `lsof -nP -iTCP:47615 -sTCP:LISTEN`.

## The run

1. **Press 과거 리뷰 전체 연동하기.** No plan exists, so the card attaches to the import carrier, mints a
   DISCOVERY ticket, and sends `START_RUN`. Expect step 1/5 then 2/5.
2. **Bounds read → CONFIRMED `UNREADABLE` on this surface** (`minAttrs: 0, maxAttrs: 0` on two correctly-found
   inputs). The card then asks for the earliest date (3/5) and the latest (4/5) and records
   `OPERATOR_CONFIRMED`. Two things the wording currently gets wrong, both recorded as open: NAVER restricts
   nothing, so "선택할 수 있는 가장 이전 날짜" describes a limit that does not exist — what the seller is really
   choosing is how far back to import; and **the range they pick becomes the plan**, so a three-year span is 37
   segments.
3. **The plan appears.** Step 5/5 reports the range, the backend creates the monthly segments, and the card
   re-reads the plan: 진행 shows `n개 구간 중 0개 완료` and 가져올 수 있는 기간 shows what discovery found.
4. **Press 계속 가져오기 (ONE segment only).** A SEGMENT ticket, then the eight-step guided export: the card
   names the required window, the runtime highlights start date → end date → export → NAVER's own `확인`.
   **Expect the start-date barrier to stall immediately** — discovery left its own start date in that field and
   the first segment begins on the same day, so there is no value change to observe (finding 13). Until that is
   fixed the way through is: pick a deliberately wrong start date, let the barrier pass, set the end date, and
   correct the start afterwards. The gate then blocks and the recovery path is exercised on the way — which is
   how this run proved it.
5. **When the gate blocks**, the marketplace page shows nothing (finding 12) — the previous step's highlight is
   still there and reads as "still waiting". The blocker lives only in the SellerOps card, whose recheck button
   is labelled **확인 완료** (not "다시 확인"). Correct the dates, press it, and the gate re-reads.
6. **Stop after that segment completes.** The bounded-proof limit is unchanged.

## What must be true afterwards

- attempt `SUCCEEDED` with a row count from the backend, segment `COMPLETED` + `COVERED`, both tickets
  `CONSUMED`; the plan's `range_evidence` is whatever discovery actually established, never upgraded.
- No launch ref, date, filename, path or URL in any log or wire frame.
- Every marketplace click attributable to the operator.

## If it stops

**Read the log before changing code.** The 2026-07-25 run produced a stall that looked like a broken date field
and was actually a correct scope block 30 seconds earlier; a wrong fix went in before the log was checked.
`aw_import_scope_verdict` tells you which. Then read the card — the blocker is rendered there with its repair.
On a genuine fail-closed stop, report sanitized structure only (counts, booleans, enums) and ask the operator
for the minimum structural fact that would discriminate between causes (attribute NAMES, class lists, iframe
presence) rather than guessing twice. Never widen a selector without evidence and never click for the seller.

## Teardown

Stop the agent (SIGINT to the pid on port 47615 — see trap 5; it closes the bridge and the browser once),
confirm all three ports are closed, drop the disposable database under its name guard with `sellerops`
surviving, and keep `collector/.profile/naver` (the login profile is gitignored and worth keeping). Delete
`frontend/.env.local` — it points at a database that no longer exists, and leaving it makes the next session's
first read fail for a reason that has nothing to do with their change. `collector/.import-runs/` markers are
gitignored; they carry no ref, date or path.
