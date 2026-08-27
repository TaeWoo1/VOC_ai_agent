# Disconnected Channel Onboarding Live Walkthrough v1

**Status:** 2026-08-27 · `frontend/` only · backend unchanged · **marketplace calls 0 · marketplace WRITE 0 ·
model calls 0 · migrations 0** ⇒ no `docs/evidence/INDEX.md` row.
**PRIMARY live walkthrough: NOT RUN** — blocked on a product-owner decision (§8) and a fresh in-turn approval.

The package's question was not "does the connect button work". It was whether a seller who has just signed
up is carried from **연결했습니다** to **reviewnary가 내 판매 운영을 이해하기 시작했습니다**. The audit found
the machinery for that already built and **nothing standing on it**.

---

## 1. What the audit found

### 1-1. Every channel's connection ends with facts about our plumbing

All three first-connect journeys exist and are complete. All three end the same way:

| | NAVER | Coupang | Cafe24 |
|---|---|---|---|
| entry | `/connect/naver` guided wizard | `/connect/coupang` 6-step tutorial | `/connect/cafe24/tutorial` 7-step |
| seller supplies | Commerce API application id + secret | Wing access key · secret key · vendor code | mall id |
| auth shape | key in our vault | key in our vault | OAuth consent |
| helper needed | only for the *guided* issuance mode | only for the *guided* issuance mode | **none** |
| first acquisition | first `ORDER_SUMMARY` sync, polled to terminal | first `ORDER_SUMMARY` sync, polled to terminal | one read-only order sync (skippable) |
| completion screen showed | 연결 상태 + 마지막 성공 수집 + capability panel | 연결 상태 + 마지막 성공 수집 + 만료일 | capability panel |
| completion CTA went to | `/settings/review-import` | `/orders` | `/settings/channels` |

Four facts about the connection and **none about the shop**, and the primary control sent the seller back
to the list of things to connect. Nothing on any of the three reached 홈, the briefing, or 「무엇을
도와드릴까요?」.

### 1-2. The contract that answers §6 and §7 exists and had zero consumers

`ChannelCoverageRow` (`backend/src/main/java/com/sellerops/coverage/`) already carries, per
channel × data type: `state`, `supported`, `connected`, `routineEnabled`, `lastSuccessfulSyncAt`, `rows`,
`openRows`. And `ChannelDataState` is §7 written out in full, in this repository, months ago —
`ZERO` ≠ `OBSERVED_FRESHNESS_UNPROVEN` ≠ `BLOCKED` ≠ `NOT_SUPPORTED` ≠ `NOT_CONNECTED`, with the rule
「`ZERO`는 이 표에서 가장 희소한 값」 in its own docblock.

`GET /api/channels/coverage` had **no frontend consumer at all**. The service was used (metrics, inquiry
publish); the endpoint was not.

So §6/§7 needed **no new backend, no new enum, and no new endpoint** — only a screen willing to read one.

---

## 2. What was built

### 2-1. `lib/firstSourceSummary.ts` — the state decides the sentence, the run decides the number

One pure module, one line per data type, in 주문 → 문의 → 리뷰 order.

| coverage state | line | may say 없습니다 |
|---|---|---|
| `NOT_SUPPORTED` | 「리뷰는 이 채널에서 제공하지 않습니다.」 | — (a fact about the API, not the shop) |
| `BLOCKED` | 「문의를 가져오지 못하고 있습니다. 연결을 다시 확인해 주세요.」 | no |
| `NOT_CONNECTED` | 「주문은 아직 연결되지 않았습니다.」 | no |
| `ZERO` | 「확인된 문의가 없습니다.」 | **yes — the only one** |
| `OBSERVED_*` + finished run, rows > 0 | 「주문 20건을 가져왔습니다.」 | — |
| `OBSERVED_*` + finished run, 0 rows | 「새로 가져온 문의는 없습니다.」 | no |
| `OBSERVED_*` + no run | 「리뷰는 아직 확인하지 못했습니다.」 | no |

**The number never comes from `rows`.** `rows` counts everything the org holds, seeded rows included, and
a seeded row has never been handed over by anyone; a count printed under 「가져왔습니다」 must be structurally
unable to include one. It comes from a terminal `SyncRunView.successRows` — what the channel returned.

**And the verb had to be corrected by an observation.** The first implementation said 「확인했습니다」, which
is a claim about what the channel *holds*. Rendered against the Demo Org's real Coupang connection it
printed **「문의 0건을 확인했습니다」 for an org holding two Coupang inquiries** — because `successRows` is what
*this run* fetched, and on a re-visit that is not the same number. 「가져왔습니다」 is true in both readings,
and a run that brought nothing back gets its own line rather than being allowed to become 「문의가 없습니다」.

The headline never adds two counts: 「주문 20」 and 「문의 22」 are two facts, and 「42건」 is a third one
nobody read.

### 2-2. `components/connect/FirstSourceSummary.tsx` — the card all three journeys now end at

Headline · one line per data type · **one primary control, 「오늘 할 일 확인하기」 → `/`**, which is where the
briefing and the command box already live (§9 needed no new surface). The old destinations survive as
ghost buttons.

Two read-only calls, both of rows this backend already holds. **Nothing here contacts a channel and nothing
here can start a run** — a completion screen that kicked off work would make 「완료」 the name of a thing
still happening. One wide `try`: any way a read can fail ends at the handoff *without lines*, because
silence about what was collected is a smaller lie than a number that came from nowhere.

Wired into all three: Cafe24 `done`, Coupang `connected` (directly under the completion banner — see §5),
NAVER `completed`.

### 2-3. The disconnected home — §17's answer to 「지금 무엇을 해야 하는가?」

This is the finding the package existed to produce, and it was **only observable once a genuinely
disconnected org existed** (two previous packages recorded it as unobservable: the Demo Org has all three
channels connected).

A seller two minutes past signup saw:

> 지금 먼저 확인할 일은 없습니다.
> 새로 들어온 문의나 리뷰가 생기면 여기에 먼저 정리해 두겠습니다.

over 0건 · 0건 · 0건, three all-zero seven-row tables, and a channel table of dashes. The greeting was
**arithmetically correct and operationally false**: there IS one thing to do, it is the only thing, and it
was not on the screen.

`AgentBriefing` now reads whether the org holds a `CONNECTED` account, and while it does not, the greeting
**stops counting**:

> 판매 채널을 연결하면 시작할 수 있습니다.
> 채널을 연결하면 주문·문의·리뷰를 대신 확인하고, 먼저 봐야 할 일을 여기에 정리해 두겠습니다.
> **[채널 연결하기]**

Not a fourth briefing group and not a flag: it **replaces** the greeting, because before the first
connection a count of waiting work is not a fact yet — it is the absence of a reading. It disappears by
itself the moment one connection exists. **A failed read is `null`, never `false`** — telling a seller with
three working connections that they have none would be this screen inventing an outage, and it is the one
error here the seller could not check.

Measured: CTA at **y = 266**, above the fold at 900 **and** at the 1152×720 (125%-equivalent) viewport.

### 2-4. §11 — the runtime did not answer, and the screen knew at mount

`/agent` fetched `/capabilities` first and **threw the answer away**. With the runtime down the box stayed
enabled, the seller typed, pressed, waited, and read a failure.

Now: the reason renders **above** the input (it shipped below the input and the account picker — the seller
met a dead control first and its reason third), the box and both run controls are disabled, and no run is
started to discover what the page already knew.

> **AI 도우미를 시작하지 못했습니다.**
> 채널 연결과는 관계없는 문제입니다. 문의·리뷰·주문 화면은 그대로 사용할 수 있고, 홈의 「무엇을
> 도와드릴까요?」에서 미답변 문의와 리뷰 문제도 계속 확인할 수 있습니다.
> [홈으로 가기] [다시 시도]

It says 「관계없는」, **not 「채널 연결에는 문제가 없습니다」** — on an org with nothing connected that sentence
is false, and this notice is not entitled to an opinion about the seller's channels, only about the fact
that this failure is not one of them.

### 2-5. §12 — elapsed time, not progress

Audited: the planner call is **one blocking HTTP request**. `AgentRunView.trail` arrives *with* the answer,
and there is no thread id before the response, so `getRun` cannot be polled. Staged progress
(「요청을 이해하고 있습니다」 → 「관련 문의와 리뷰를 확인하고 있습니다」) **requires a new protocol** — an
id-first start or SSE — and §12 says report it rather than build it. Reported; not built.

What shipped without a protocol is a fact: 「문의·리뷰·주문을 확인하고 있습니다. 보통 20초쯤 걸립니다 · N초
경과」. A live clock is measured; a bar or a stage list would be an animation of something nobody measured
(`reviewnary_design.md` §13).

### 2-6. Contrast, measured on the onboarding path

Two AA failures, both on a step indicator a first-time seller reads before anything else:

| where | before | after |
|---|---|---|
| Cafe24 tutorial, ACTIVE step chip (`text-brand` on `bg-brand/15`) | **2.85:1** | `brand-800` — **pass** |
| Coupang stepper badge (`bg-brand` + white) | **3.71:1** | `brand-700` — **5.41:1** |

`brand-700` was tried first on the Cafe24 chip and reached only **4.16:1** — a colour must be checked on
the surface it lands on, not on white. This is the same lesson as the hover fix one package ago, on a
different axis.

---

## 3. Disconnected test org (§1)

Created through the product's own `POST /api/auth/signup` — the honest disconnected start, because
`AuthService.signup` creates an Organization with no accounts and `MockDataSeeder` only ever runs when
`organizations.count() == 0`.

Measured after the walkthrough:

| org | accounts | inquiries | reviews |
|---|---|---|---|
| **온보딩 테스트 상점** (new) | **0** | **0** | **0** |
| 데모 제조사 (canonical Demo Org) | 4 | 3,355 | 4,551 — unchanged |

**No fake marketplace success state was written.** The session was seated by injecting the signup response's
own JWT, so no password was typed into any form.

---

## 4. Browser walkthrough (§16)

Chromium 1440×900@2×, real local backend, `shots3/`. **Off-host requests: 0** on every capture (asserted
by a request listener, not by inspection). Console errors: 0 except the two deliberate
`ERR_CONNECTION_REFUSED` in the runtime-down capture.

| # | screen | route | result |
|---|---|---|---|
| 40 | disconnected start | `/connect` | 연결 필요 ×3 · 수집 이력 없음 — **no connected UI is drawn** (§19-A) |
| 41 | disconnected home | `/` | the connect briefing; CTA y=266, above fold at 900 **and** 720 |
| 42 | channel setup | `/connect/cafe24/tutorial` | 7-step rail, 시작하기 |
| 43 | NAVER entry | `/connect/naver` | mode choice — **leads with the helper path** (§8) |
| 44 | Coupang entry | `/connect/coupang` | 안내 시작 · 「이미 키가 있어요」 |
| 45 | failure/recovery | `/connect/cafe24/result?status=reconnect_required` | 다시 연결하기 |
| 46 | success + source summary | `/connect/coupang` (Demo Org, read-only) | 주문 20건을 가져왔습니다 / 새로 가져온 문의는 없습니다 / 리뷰는 아직 확인하지 못했습니다 · card at **y=447** |
| 47 | runtime unavailable | `/agent` | the §11 state, box disabled |

AA text-node contrast, composited over tints: **0 failures** on 41 · 40 · 42 · 46 · 47 after §2-6.
Horizontal overflow: 0 everywhere.

Screen 46 is the Demo Org's already-connected Coupang account, landed read-only — the page derives its
phase from persisted state and makes no channel call until an explicit submit. NAVER's completion screen
was **not** rendered live: `/connect/naver` on a connected account runs a connection test against NAVER, and
this package has no approval for one. Its wiring is covered by unit tests only, and that is stated here
rather than implied.

---

## 5. §17 — the five questions, on the screens as they now stand

| | disconnected 홈 | 연결 화면 | 완료 화면 |
|---|---|---|---|
| 지금 무엇을 해야 하는가 | 「판매 채널을 연결하면 시작할 수 있습니다」 + one button | the step rail names the current step | 「오늘 할 일 확인하기」 |
| 왜 이 정보가 필요한가 | subline says what connecting buys | Cafe24 lists what is read; Coupang/NAVER explain each field | — |
| 연결이 됐는가 | — | 연결 상태 + step rail | 완료 배너 |
| 무엇을 가져왔는가 | — | — | **the summary card** (was: nothing) |
| 이제 무엇을 해줄 수 있는가 | subline | — | 「앞으로는 새 주문·문의·리뷰를 알아서 확인해 정리해 드립니다」 + 홈 |

---

## 6. §13 — SellerOps helper naming audit

The previous package deferred this to whoever owned the connection flow. The finding is **not a brand
mismatch**, and a rename would not touch it.

| question | answer |
|---|---|
| actual executable / display name | **none** — no `.app`, no `.exe`, no bundle; the helper is `npx tsx collector/src/cli/local-agent.ts` from a developer checkout |
| what the OS shows the user | a launchd **user agent** labelled **`ai.sellerops.local-agent`** (`~/Library/LaunchAgents/ai.sellerops.local-agent.plist`). No Dock icon, no menu-bar item, no window |
| installer / package name | **none** — `@sellerops/collector`, `private: true`, `0.0.1-poc`; no electron-builder / pkg / notarisation config anywhere in the repo |
| what onboarding tells the seller to find | **「내 PC의 SellerOps 도우미」** — `guidedConnection/copy.ts`, `AgentPairingPanel` (「도우미를 실행한 뒤 다시 시도해 주세요」), `AgentDock`, both guided walkthroughs |
| internal identifiers | `@sellerops/collector` · `ai.sellerops.local-agent` · `SELLEROPS_*` env · `com.sellerops.*` |

So the screen names a program the seller **cannot obtain, install, or start**, and gives no instruction for
doing so. Renaming 「SellerOps 도우미」 → 「reviewnary 도우미」 would leave the instruction equally
unfollowable while deleting the only string that matches the launchd label a support person would grep for.

**Recommendation: do not rename, in this package or the next one, until there is something to name.** The
migration order is: package and name an installable helper → choose the display name once → migrate the
`ai.sellerops.local-agent` label with a documented plist rename → then move the UI strings, all at once. No
rename was performed (§13).

---

## 7. §10 — agent-runtime lifecycle

**There is a lifecycle owner, and it is `docker-compose.yml`.** `agent-runtime` is a service with
`depends_on: backend (service_healthy)`, and `frontend` depends on it; `docker compose up` starts postgres,
backend, agent-runtime and frontend together. A seller on the compose deployment needs no developer command.

The collector / local helper is deliberately **not** in the stack — it holds live browser profiles and runs
on the seller's own machine (see §6 for what that currently means in practice).

The 8787-in-a-separate-terminal problem is therefore **a property of our local dev path** (`bootRun` +
`vite`), not of the packaging. **No packaging architecture is needed and none was built.** What remains
true is §6: the compose stack has no answer for the helper, because there is no helper artifact.

---

## 8. §14 — PRIMARY channel choice, and why the live walkthrough did not run

| criterion | NAVER | Coupang | **Cafe24** |
|---|---|---|---|
| seller must obtain | Commerce API app + secret | Wing keys + call-IP registration | **mall id only** |
| local helper | guided issuance is the DEFAULT landing | guided issuance is the default landing | **none, ever** |
| irreversibility | **highest** — one app per store, **not deletable**; re-issuing the secret breaks every other tool sharing it | medium — key issuance + IP allowlist edit | **lowest — a revocable consent** |
| rollback | remove our credential; the NAVER app stays | remove our credential; the Wing key stays | disconnect + revoke the app authorisation |
| interaction complexity | highest | high | **lowest** |

**PRIMARY = Cafe24**, and it is not close: it is the only one whose entire authorisation is a consent the
seller can withdraw, and the only one that never mentions a program that does not exist.

**The walkthrough did not run, and the blocker is not the approval.** §1 requires **zero conflict with
existing seller accounts**. The only Cafe24 mall available is the one already connected to the canonical
Demo Org, and a second OAuth grant for the same (app, mall) is **not provably collision-free from this
repository** — Cafe24 issues tokens per authorisation, and whether the previous refresh token survives is a
vendor behaviour we have not observed. If it does not, the Demo Org's Cafe24 connection breaks, and that
connection is what every inquiry-lane `LIVE_VERIFIED` proof in `docs/evidence/INDEX.md` stands on.

Guessing here is exactly the failure mode this repository documents. So:

- **product-owner decision:** which Cafe24 mall (or which channel account) may the disconnected org connect?
  A second mall, a second Cafe24 app, or an accepted risk to the Demo Org's grant.
- **then:** a fresh, single-use, in-turn approval against the manifest in §9.

The other two channels are **not** live-proven here and are not claimed to be: NAVER's completion screen was
not rendered live at all, and Coupang's was rendered only from persisted state on an already-connected
account. Everything else in §4 is offline/runtime walkthrough.

---

## 9. Bounded manifest, prepared and unused (§15)

Written so the walkthrough is one approval away, not one design away.

| field | value |
|---|---|
| org | 온보딩 테스트 상점 (`3d9e0318-…`) — 0 accounts, 0 rows |
| channel / account | **Cafe24**, mall **TBD — §8 product-owner decision** |
| auth operation | one OAuth authorisation-code grant, read scopes only (`mall.read_order` · `mall.read_community` · `mall.read_product`) |
| marketplace READ max | **8** (token exchange 1 · capability check ≤2 · one `ORDER_SUMMARY` sync ≤5) |
| marketplace WRITE | **0** — `mall.write_community` is not requested and `Cafe24ScopeContract` refuses it at boot |
| initial acquisition | `ORDER_SUMMARY` only, one run, the tutorial's existing 「첫 수집 실행」 |
| scheduler state | OFF |
| connector flags | default; proactive OFF; self-pilot OFF |
| model calls | **0** (the summary and the briefing are arithmetic; no draft is generated) |
| expected local DB mutation | 1 `seller_account` · 1 credential · 1 `sync_job` · ≤N `order_daily_summary` rows, all in the new org |
| rollback / disarm | delete the seller account + credential in the new org; revoke the app authorisation in the mall admin |

---

## 10. Reported, not changed

1. **The disconnected home is still a wall of zeros below the briefing** — three 0건 cards, three all-zero
   seven-row tables, a channel table of dashes. The briefing now answers 「무엇을 해야 하는가」 above them, so
   they are context rather than the answer; hiding them is a Home redesign, which §0 forbids.
2. **「채널 3곳이 이 숫자에 없습니다」 renders in the warn colour** on a brand-new org, where it is not a
   warning — it is the normal state of a shop that has not connected anything.
3. **`「SellerOps」` still appears in seller-facing connect copy** (e.g. Coupang's 「SellerOps는 만료일을
   임의로 추정하지 않습니다」). That is product copy the previous package deliberately left; §13 is about the
   executable, and §6 above says why moving these strings now would be premature.
4. **`/settings/channels`** is still the 돌아가기 target in two Cafe24 screens. It works — a legacy redirect
   to `/connect` — but it is a hop the seller pays for.
5. **NAVER and Coupang lead with the guided-issuance mode**, which requires the helper of §6. The text
   fallback exists on both; it is the second choice on the screen.
6. **Staged planner progress needs a new protocol** (§2-5). Not built.
7. **NAVER's completion screen has no live render** (§4).

---

## 11. Counts

marketplace calls **0** · marketplace WRITE **0** · model calls **0** · migrations **0** · backend files
changed **0** · DB rows changed: **one new empty org + one user, in the new org only**.

Tests: frontend **185 files / 2,424 tests / 0 failures**.
