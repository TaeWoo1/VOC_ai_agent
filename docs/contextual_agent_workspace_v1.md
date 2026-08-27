# Contextual Agent Workspace & Interactive UX QA v1

**2026-08-27** · branch `feat/proactive-operations-agent-v1` · `frontend/` only · backend API contract,
domain semantics, Agent safety, Human Approval and routes **unchanged** · marketplace WRITE 0.

Builds on Reviewnary Product UI Redesign v1 (`docs/reviewnary_design.md` v2). Two additions and one
discipline: the Agent attaches to every operations page as a **contextual right-side panel**, the
charts become **operational controls**, and the whole thing was **QA'd in a real browser against the
running stack at this commit** (backend · agent-runtime · frontend), twice, with the findings fixed
between the two passes. Design rules landed in `docs/reviewnary_design.md` §8-A / §8-B.

## 1. Agent shell

- `AgentPanelProvider` (`lib/agentPanel.tsx`) holds two things that are different: the **surface** a
  page registers (`useAgentSurface` — 「이 상품 · …」, cleared on unmount) and the **request** a launcher
  or the home box hands over. `AgentLaunch` becomes a button inside the shell and stays the `/agent`
  link outside one (tests render pages bare).
- `AgentPanelDock` (`components/agent/AgentPanel.tsx`): 400px, closed by default, **docked ≥1440px,
  overlay below**, pin remembered per browser. Header shows the current surface; it follows the route
  (TC-AGENT-02: 「상품 목록」 → 「주문 · 최근 7일」 without closing).
- One answer rendering: `OperatorAnswerView` was **moved out of `pages/Agent.tsx` unchanged** so the
  page and the panel cannot drift; `compact` hides the planner-id line (design §9).
- Home keeps its inline command box; an **unrecognised** sentence now opens the panel and runs
  (the seller pressed send); a recognised one is still an object on the home and opens nothing.

## 2. Human Approval boundary

`lib/agentSendFence.ts`: a sentence that asks to send gets the approval boundary printed under the box
before any wait. The run still goes to the planner unchanged (READ-only catalogue). The structural
fence is `agentPanelWriteFence.test.ts` — the panel and the answer view import nothing that can
publish, approve or resume. Live TC-AGENT-04 (「이 문의에 답변 보내줘」): fence rendered, planner
answered with a queue investigation, **browser write requests during the run: 0**.

## 3. Interactive analytics

`components/ui/TrendChart.tsx` rewritten (SVG, no library): hover/keyboard tooltip with exact values,
legend toggles (`aria-pressed`, last series cannot hide), per-unit scales with both maxima named,
sparse date ticks, and `onSelectDate` — bands become buttons **only** when passed. `pages/Orders.tsx`:
`?days=` / `?channel=` / `?date=` are the filter; range control, channel select, channel-table rows
and chart bands all write to it; KPI + chart + table read one response per filter; a drilled-in day
labels the figures with the day and keeps the chart on the window with the day highlighted. Home:
sales chart points drill into `/orders?days=N&date=…`; inquiry/review cards link to their screens and
their points are inert (no day filter exists there). `components/Charts.tsx` (the old bar chart) is
deleted.

## 4. QA — how it was run

The three processes were **restarted on this commit** (`2852f583` + this package's working tree) before
any screenshot. The HEAD backend **refused to boot** with the operator's existing `backend/.env.local`:
`PilotConfigValidator` (Pilot Runtime Foundation v1) requires a public HTTPS Cafe24 callback when the
Cafe24 connector is enabled, and the local file has none. For this QA the process was started with a
QA-only override `SELLEROPS_CONNECTOR_CAFE24_REDIRECT_URI=https://qa-local.invalid/…` — a reserved,
unresolvable host that makes any OAuth consent impossible while letting token-refresh READ boot.
No OAuth ran. **This is a P0 for local dev** and a product-owner decision (§7).

`scratchpad/qa/qa.mjs` (Playwright, Chromium, fixture login via API — token never printed) runs the
test cases of §5 at 1440×900@2×, then 1152×720, 1366×768, 1024×768, panel closed and open; the
contrast audit composites every text node over its real background on 7 routes + the open panel.

## 5. Test cases executed (iteration 2, all PASS)

TC-HOME-01 (briefing y=48, command 104, first work row 247, numbers 623 — all above 900 and 720) ·
TC-HOME-02 (「미답변 문의 보여줘」 → 5 rows) · TC-HOME-03 (tooltip `8월 24일 · 매출 ₩574,990 · 주문 30건`) ·
TC-HOME-04 (band → `/orders?days=7&date=2026-08-23`, day chip) · TC-PRODUCT-01/02 (list context 「상품
목록」, detail context 「이 상품 · 15223228019」, sentence prefilled, docked) · **TC-AGENT-RUN-PRODUCT**
(live planner run from the product page: 49s, 6 findings, 1 product object) · TC-REVIEW-01/02/03 ·
TC-INQUIRY-01/02/03 (state word first; 「1년 넘게 지난 답변 필요 문의 21건」 divider at y=205; panel
context 「이 문의」; list row 338px with the panel docked) · TC-AGENT-04 · TC-ORDER-01..05 (range sync,
tooltip, legend, channel drill, day drill) · TC-CHANNEL-01 (오류·오류·연결됨) · TC-SETTINGS-01 ·
TC-AGENT-01/02/03 (open/close/Esc; context switch; free-text failure rendered as a state).
Viewports: horizontal scroll 0 everywhere; panel overlay below 1440 (main 1134/920/792px).

## 6. Findings

| Sev | Finding | Outcome |
|---|---|---|
| P0 | HEAD backend cannot boot with the operator's `.env.local` (Cafe24 enabled, no HTTPS callback) | reported; QA-only inert override; **product-owner decision** |
| P1 | overlay panel clipped the inquiry detail at 1440 | docked by default ≥1440 |
| P1 | 「문제 있는 상품 찾기」 opened an empty box | launcher carries its sentence |
| P1 | panel printed the planner/model id on a failed run | hidden in compact mode |
| P1 | chart had no calendar; drill-down not discoverable | date ticks + 「점을 누르면 그 날만 봅니다」 |
| P2 | review tier filter was four outline buttons beside a segmented sort | segmented, same shape |
| P2 | numeric product names read as ids | 「코드」 mark + tabular figures, name unchanged |
| P2 | pin icon read as a pen | pin glyph |

Reported, not fixed: the review 「반복되는 문제」 counts are not a list filter — the record endpoint takes
`tier` only and the row carries no category, so a filter would be client-side over one page (a fake
count); `AgentContext` has no inquiry id, so 「이 문의 조사하기」 sends the surface, not the row (runtime
contract change, out of scope — **closed by `docs/contextual_agent_contract_completion_v1.md`**); the
planner's sentences can contain raw enums (`COUPANG`, `UNKNOWN`, `14500KRW`) — **re-audited there: they
were ours, deterministic, and are mapped**; `/reviews` posts one behaviour-telemetry row on load (pre-existing).

## 7. Counts

Marketplace calls **0** (backend log: no connector activity, 0 ERROR) · marketplace WRITE **0** · model
calls **3** (planner runs, all from the panel) · DB writes from the browser: the pre-existing review
behaviour telemetry POST only · migrations **0** ⇒ no evidence row.
