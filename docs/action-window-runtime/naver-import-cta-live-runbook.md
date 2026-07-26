# Live CTA E2E runbook — 과거 리뷰 연동, the plan finished inside the SmartStore window

**The procedure, current as of 2026-07-26.** Its one-segment form RAN ONCE on 2026-07-26 — one segment, 62 rows, two
operator interactions with the marketplace (Addendum 4 in `naver-initial-review-import-live-proof-record.md`). The
2026-07-25 run (Addendum 2) used the flow before that, which this replaces.

**New later that same day, and NOT yet live-run: step 6.** A finished segment now leaves a panel offering the next month,
so the operator continues **from the marketplace window** instead of returning to SellerOps between exports
(Addendum 5; offline-proven across a real socket only).

Still untested live: two segments in one sitting, a `SCOPE_MISMATCH` under the in-page panel (the gate matched on the
first read), an apply-requiring surface, and the pairing approval control.

Everything here is rehearsed offline against a real socket
(`collector/test/crossstack/fe-import-runtime-real-bridge.test.ts`); a live run adds the one thing a fixture
cannot — how the real NAVER surface answers, and whether a seller can finish a month **without looking back at
the SellerOps window**, which is the whole point of the change.

**This run requires a fresh, single-use, in-turn approval and a seated operator.** A plan is never
authorization. The operator performs every marketplace click; the runtime only detects, highlights, observes.

## Preconditions

| | |
|---|---|
| Backend | disposable, name-guarded `sellerops_riv_live_*`, V27/V28 applied, on `127.0.0.1:18090`. Never the persistent `sellerops`. |
| Seed | one org/user + one NAVER seller account in `CONNECTED` — the card needs an `accountId`. `POST /api/auth/signup` → `GET /api/channels` (take the `NAVER` id) → `POST /api/seller-accounts/file-channel {channelId, alias}`. That endpoint sets `CONNECTED` + `fileUpload`, which is all the card reads. |
| Frontend | `frontend/.env.local` (gitignored) with `VITE_API_BASE_URL` and `VITE_BRIDGE_URL`; then `npm run dev` on `:5173`. `VITE_ENABLE_AGENT_BRIDGE` is **no longer needed** for pairing — see trap 2. |
| Agent | `npx tsx src/cli/local-agent.ts --action-window-initial-review-import --i-understand-this-opens-live-naver`, with `NAVER_REVIEW_URL` and `SELLEROPS_BASE_URL`/`_EMAIL`/`_PASSWORD` pointed at the disposable backend. Bridge on `47615`. |
| Pairing | the agent shows the approval code through its own human channel (macOS production: a native dialog; DEV: its stderr — see trap 3). Approve from the 도우미 연결하기 panel on the import card itself. |
| Login | the operator logs into NAVER themselves, in the browser the agent opened. The profile persists, so an agent restart does not cost another login. |

### Traps — two are now fixed in code, four still bite

1. ~~**Browse `localhost:5173`, not `127.0.0.1:5173`**~~ — still true (`sellerops.cors.origin` allows exactly ONE
   origin), but it no longer produces a wrong diagnosis: the login form now says
   "SellerOps 서버에 연결하지 못했어요" when nothing answered and only blames credentials when the server
   actually rejected them (`frontend/src/lib/loginError.ts`). Use `localhost` anyway — it is one fewer variable.
2. ~~**The pairing UI is behind `VITE_ENABLE_AGENT_BRIDGE=true`**~~ — **fixed** (finding 14). The import card
   carries its own 도우미 연결하기 panel, ungated. The old `BridgeStatus` corner console is still behind the flag
   and is still an operator surface; you do not need it.
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
6. **The login form pre-fills `demo@sellerops.ai`, so the operator and the agent can end up in DIFFERENT orgs.**
   The browser then creates the plan and the ticket in one org while the agent resolves refs in another, and the
   server correctly answers `404 가져오기 요청을 찾을 수 없습니다` — the same answer as a spent or non-existent
   ref, by design. The symptom appears three steps later as `aw_import_host_scope_refused` and no run. Cost the
   first `계속 가져오기` on 2026-07-26. **Either replace the pre-filled credentials at login, or start the agent
   with the org the operator is actually in.** Check before involving them:
   `psql -d $DB -c "select l.org_id, u.email, u.org_id from review_import_launch l, users u"` — the two org ids
   must match. Restarting the agent with the right credentials is the whole fix; the plan survives.

## The run

1. **Choose the period, in SellerOps.** With no plan the card asks 언제부터 가져올까요 and offers a start month.
   The line under it is the whole decision: `2025-07-01 ~ 2026-07-26 · 13개 구간` — the period **and** how many
   hand-performed exports it becomes. Both numbers come from the server (`GET /plans/range-preview`); nothing is
   created by looking. Press 이 기간으로 시작하기 → `POST /plans/selected-range` creates the plan with
   `range_evidence = OPERATOR_SELECTED`. **No marketplace window opens for this step**, and no range discovery
   run exists any more.
2. **Press 계속 가져오기 — once, and only once for the whole sitting.** The card attaches to the import carrier, hands
   the agent the guidance pack (now including what to say when the segment finishes), mints a SEGMENT ticket for the
   **most recent** remaining month, and sends `START_RUN`. Every segment after this one is started from the
   marketplace window in step 6 — if you find yourself pressing this button a second time, note it: that is the
   failure this slice exists to remove.
3. **The seller-center window comes up by itself** — the run raises it and, if it has drifted off the review
   surface, navigates back (⚠ added AFTER the 2026-07-26 run, so this step is **not itself live-proven**; on that
   run the operator had to find the window). A SellerOps panel appears bottom-left in that page: the product name,
   `8단계 중 3`, what to do now, and 가져올 기간 for this segment. From here on the SellerOps tab is a summary you
   do not have to watch — that is the property this run exists to test. Note whether the panel ever sits over
   something you need.

   It will NOT navigate while you are on a login, a 2FA prompt, or any other off-origin page — that would destroy
   an authentication in progress. There the window is only raised, and the run then fails closed on
   `LOGIN_REQUIRED`, which you clear yourself before pressing 계속 가져오기 again. `aw_import_surface_present`
   logs which branch was taken (`already_there` / `drifted` / `off_origin` / `unconfigured` / `unreadable`).
4. **Follow the highlights.** start date → end date → (조회, if the surface has one) → 엑셀 다운로드 → NAVER's own
   `확인`. A date field that **already holds the required value is skipped** — the panel moves on and the step is
   reported `SKIPPED` (finding 13). If the panel asks for a date the field already shows, that is a regression,
   not an instruction: stop and read `aw_import_prefilled_probe`. On 2026-07-26 the current-month segment needed
   exactly **one** date typed: the end date defaulted to today, was probed `prefilled: true`, and was skipped.
5. **If the gate blocks**, the highlight comes off and the panel states the cause (선택한 기간이 달라요), the
   repair (날짜를 다시 선택해 주세요) and a button labelled for the repair — **날짜 다시 확인**, not 확인 완료.
   Fix the dates in the page, press it, and the gate re-reads. Everything in this step happens in the
   marketplace window; nothing requires the SellerOps tab.
6. **When the segment completes, the panel does not disappear — it hands you the next one.** A green box appears in
   the same panel: 이 구간 완료, then the next month and how many are left, and 다음 구간 계속하기. Pressing it starts
   the next segment **without touching the SellerOps window**: the press is forwarded to the frontend, which mints a
   fresh single-use ticket through the same `POST /plans/{planId}/launches/next-segment` its own button uses, and the
   agent hosts the new run on the same connection. Verify in the log: `aw_import_panel_intent_forwarded`, then
   `aw_import_run_armed` + `aw_import_run_hosted` with no new socket.

   On the LAST segment the same box says the plan is finished and offers **no** control. And if nobody presses it for
   fifteen minutes the panel comes down (`aw_import_panel_idle_closed`) — that is deliberate, not a fault; continue
   from the SellerOps card.

7. **Stop after the SECOND segment completes.** The bounded-proof limit is now two, and it is what makes this a
   proof of the continuation rather than of one more segment. Do not run a third.

## What must be true afterwards

- **Two** attempts `SUCCEEDED` with row counts from the backend, both segments `COMPLETED` + `COVERED`, and **two
  distinct SEGMENT tickets** both `CONSUMED` — never one ticket spent twice. Check:
  `psql -d $DB -c "select kind, status, segment_id from review_import_launch order by issued_at"`.
- The two segments are the **two most recent** remaining months, newest first.
- The plan's `range_evidence` is `OPERATOR_SELECTED` and is never upgraded to a machine claim.
- The operator never had to read the SellerOps window after the first press — including between the two segments.
  If they did, say where.
- No launch ref, date, filename, path or URL in any log or wire frame. `aw_import_guidance_pack` logs COUNTS
  only — if a sentence appears in a log line, that is a defect.
- Every marketplace click attributable to the operator. The panel's own buttons are SellerOps controls and are
  the only clicks the runtime is involved in at all.

## If it stops

**Read the log before changing code.** The 2026-07-25 run produced a stall that looked like a broken date field
and was actually a correct scope block 30 seconds earlier; a wrong fix went in before the log was checked.
`aw_import_scope_verdict` tells you which, and `aw_import_prefilled_probe` says whether a date step was skipped.
Then read the panel — the blocker is rendered there with its repair. On a genuine fail-closed stop, report
sanitized structure only (counts, booleans, enums) and ask the operator for the minimum structural fact that
would discriminate between causes (attribute NAMES, class lists, iframe presence) rather than guessing twice.
Never widen a selector without evidence and never click for the seller.

## Teardown

Stop the agent (SIGINT to the pid on port 47615 — see trap 5; it closes the bridge and the browser once),
confirm all three ports are closed, drop the disposable database under its name guard with `sellerops`
surviving, and keep `collector/.profile/naver` (the login profile is gitignored and worth keeping). Delete
`frontend/.env.local` — it points at a database that no longer exists, and leaving it makes the next session's
first read fail for a reason that has nothing to do with their change. `collector/.import-runs/` markers are
gitignored; they carry no ref, date or path.
