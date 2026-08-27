# Pilot Readiness Gate v1

**Status:** 2026-08-27 · audit + bounded `frontend/` corrections · **no live marketplace run** ·
marketplace calls **0** · marketplace WRITE **0** · model calls **0** · migrations **0** ·
backend source changes **0**

> **What this is.** Not a feature package. The question is one question — *can a first external
> seller start this product alone?* — asked against the code that exists, and answered with a
> verdict per surface. Where the answer was "no, and the fix is which control the screen leads
> with", it was fixed here. Where the answer was "no, and the fix is a decision or a machine",
> it is written down and left alone.

**Product-owner decision that framed this package (2026-08-27):** there is no second Cafe24 mall.
The Demo Org's Cafe24 connection is the connection every `LIVE_VERIFIED` inquiry proof stands on,
so it is **preserved, not re-consented**. `docs/disconnected_channel_onboarding_v1.md` therefore
closes as:

| | verdict |
|---|---|
| Disconnected Channel Onboarding v1 — offline / UX | **PASS** |
| Disconnected Channel Onboarding v1 — fresh-account live proof | **`UNPROVEN_BY_NO_SAFE_TEST_ACCOUNT`** |

The first real pilot seller's first channel connection **is** the production live onboarding proof.
§7 below is the checklist that turns it into one.

---

## 1. What was not touched

Demo Org's Cafe24 / NAVER / Coupang connections: **no re-OAuth, no credential replacement, no
disconnect, no reconnect, no auth-state mutation**. Every browser measurement in this package ran
against the dedicated disconnected org created in the previous package, or read-only against the
Demo Org. Off-host requests measured **0** on every capture (request listener, asserted).

---

## 2. P0 audit — a first external seller, alone

The categories are the ones the gate names. Everything else is recorded in §10 and is not a blocker.

### 2-A `BLOCKED` — the deployment seeds a known-password account it cannot be told not to

`MockDataSeeder` runs whenever the database has zero organizations, which on a fresh pilot
deployment is the first boot. It creates the 데모 제조사 organization and a user
`demo@sellerops.ai` with the password `demo1234`, and the product's own login header offers
「데모 화면 보기」, which prefills exactly those two values (`Login.tsx` — `?demo=1`).

Demo *content* is correctly opt-in (`sellerops.seed.demo-content` defaults false), so the pilot
seller's own numbers stay clean — that part is not the defect. The defect is the account: on any
deployment a seller can reach, so can anybody who has read this repository.

`sellerops.seed.enabled` is the switch that would stop it and it is **hardcoded `true`** — there
is no environment placeholder, so this cannot be closed by configuring the deployment. It is a
one-line change (`enabled: ${SELLEROPS_SEED_ENABLED:true}`) plus setting it false on the pilot
host, and it is **reported, not made**: this package's authorized corrections are `frontend/`
first-use ones, and a change to what a production boot creates is the product owner's to approve.

### 2-B `BLOCKED` — nothing collects a second time until an operator edits env and restarts

`sellerops.self-pilot.enabled` defaults **false**, and with it false there is no reconciler bean
and no schedule is ever created for a newly connected account. A pilot seller therefore gets the
one first collection their connect flow triggers, and then nothing — the home screen would be
honest and permanently still.

Operator-closable without code: `SELLEROPS_SELF_PILOT_ENABLED=true` plus the seller's org UUID in
`SELLEROPS_SELF_PILOT_ORG_IDS` (scope `ALLOW_LIST`). It is `READY_WITH_OPERATOR` rather than
`READY` because **each new seller costs an env edit and a restart**, and because nobody has run
this deployment posture for days — every live proof to date ran on a disposable backend.

The same is true of 「AI가 먼저 확인한 일」: `sellerops.proactive.enabled` defaults false and its
org list is intersected with self-pilot's.

### 2-C `BLOCKED` — no channel can be connected on the documented compose path

`docker compose up` (the §6 lifecycle owner) brings up four processes correctly. It does not bring
up a product a seller can connect anything to: all three connectors default **off**
(`SELLEROPS_CONNECTOR_{NAVER,COUPANG,CAFE24}_ENABLED:false`), the credential vault fails closed
with no master key, and `.env.example` — the file the compose header tells the operator to copy —
contains **none** of those names. See §6 for the procedure that closes it.

### 2-D `FIXED` — NAVER told the seller to run a program that does not exist

Measured live 2026-08-27 on the disconnected org, no helper installed. `/connect/naver` offered
exactly one control, 「네이버 연결 안내 시작」. Pressing it produced:

> **SellerOps 도우미가 필요합니다**
> 내 PC의 SellerOps 도우미를 찾지 못했어요. 도우미를 실행한 뒤 다시 시도해 주세요.
> `[다시 찾기]` `[텍스트로 직접 진행하기]`

There is no installable 도우미 artifact in this repository — no bundle, no executable, no
installer (`docs/disconnected_channel_onboarding_v1.md` §13, unchanged). The instruction cannot be
followed by anybody who did not clone the repository, and the way out was the **smallest** control
on the screen, rendered **below** a retry for the thing that cannot be found. Fixed in §3.

The path was not a dead end: 시작 → 텍스트로 직접 진행하기 → 이미 애플리케이션이 있어요 →
credential entry reaches the end. Three presses, one of which is a question the seller answered a
minute earlier, on the other side of an error that is not theirs.

### 2-E `FIXED (copy)` — Coupang promised a window that never opened

The Coupang gate said 「시작하면 전용 쿠팡 윙 창이 열립니다」. Measured: pressing it opened
nothing and landed the seller on the 11-step text checklist with **no error** — the walkthrough's
`guidanceImpossible` fall-through is correct and was already there. A good landing after a
sentence that was not true. Fixed in §3 by not requiring the promise to be pressed first.

### 2-F `not a blocker` — the wall of zeros

Six zeros, three all-zero trend tables and a three-row all-「연결 안 됨」 coverage table on a
two-minute-old account. Arithmetically correct, and the disconnected briefing already sits above
all of it with the one action (`docs/disconnected_channel_onboarding_v1.md` §5). What DID read as
a fault is fixed in §4. Hiding the sections is a Home redesign and is out of scope.

---

## 3. NAVER / Coupang helper decision — the path that works today is the primary one

**Audited first:** is the helper actually required for either channel?

| | required? | evidence |
|---|---|---|
| NAVER | **no** | `mode:"text"` completes issuance; `existing_credential_entry` reaches the credential form with a collapsed 「기존 앱에서 어디를 확인하나요?」 tutorial. Walked in the browser, end to end. |
| Coupang | **no** | the 11-step checklist ends at 「발급을 완료했어요」 → credential entry; `guidanceImpossible` routes to it automatically when no helper answers. |
| Cafe24 | **no** | the helper plays no part at all. |

So the helper is an accelerator, not a dependency, and no `PILOT_BLOCKER` is raised for it. What
was wrong is which one the screen led with. Three gates changed, **presentation only** — no
reducer event, no bridge behaviour, no host, no walk, no connector or auth architecture:

| gate | before | after |
|---|---|---|
| `NaverIssuanceGuidedWalkthrough` start | 「네이버 연결 안내 시작」 alone (`btn-primary`) | 「직접 진행하기」 (`btn-primary`) · 「화면 안내로 진행하기 (도우미 필요)」 (`btn-ghost`) |
| `NaverIssuanceModeChoice` | 「화면을 보며 안내받기」 primary | 「텍스트로 직접 진행하기」 primary · guided ghost, labelled (도우미 필요) |
| `CoupangIssuanceGuidedWalkthrough` start | 「쿠팡 연결 안내 시작」 primary · 「이미 키가 있어요」 | 「직접 진행하기」 primary · guided ghost (도우미 필요) · 「이미 키가 있어요」 kept |

And one ordering fix: on the NAVER walkthrough, when guidance cannot run, **the way forward is
rendered above the thing that stopped** and is now the filled control
(`docs/reviewnary_design.md` §10, "Dependency down"). A seller who IS running the helper still
reaches the identical walk in one press.

**One label for one action.** The manual path is 「직접 진행하기」 on every gate and every
fallback in both channels; the prose that named the old label was corrected with it
(`lib/guidedConnection/copy.ts`) — a sentence pointing at a button that is not on the screen is
the defect this package started from.

Pinned by `helperFreeFirst.test.tsx`, which asserts the class of each control rather than its
presence: presence never regressed, prominence is the whole finding.

---

## 4. First-use disconnected UX — a qualification is not a fault

Measured on the disconnected org before the change: **three** `text-warn` nodes on the home
screen, one per KPI card, all reading 「채널 3곳이 이 숫자에 없습니다」.

A missing channel is a warning when there is a working total for it to be missing *from*: one of
four channels stopped collecting and the number under the seller's eye is quietly short. Before
the first connection there is no such total — every channel is missing by definition, and the
sentence at the top of the page already says so. In `warn`, on a two-minute-old account, it reads
as three faults: the screen inventing an outage on its first showing.

It is not hidden. The same fact is said in the plainer form, in `muted`:
**「아직 연결된 채널이 없습니다」**.

The signal is derived, not fetched — `hasAnyConnectedChannel(metrics.channels)`
(`lib/firstConnectionState.ts`), because a second read could disagree with the channel table six
inches below it. `NOT_SUPPORTED` is deliberately **not** counted as disconnection: a connected
NAVER whose reviews have no collection path is still a connected NAVER.

Measured after: home `text-warn`/`text-bad` nodes **0**, AA violations **0** (composited over
tints, every text node), horizontal overflow 0, console errors 0. The 「채널 연결하기」 CTA is
unchanged at y=266, above the fold at 900 and at 720.

---

## 5. User-facing legacy hops

**`/settings/channels` → `/connect`** in the three Cafe24 screens (`Cafe24Connect`,
`Cafe24Tutorial` × 2, `Cafe24ConnectResult`). The legacy redirect worked, so nothing was broken —
this removes a hop from the PRIMARY channel's own path and from its failure screen. No route was
added or deleted; `legacyRoutes.ts` still catches anything else.

**SellerOps wording — audited, deliberately unchanged.** On the PRIMARY (Cafe24) path there is
none: the entry, the seven-step tutorial and the result screen say reviewnary or say nothing.
Every remaining instance on NAVER / Coupang is on the helper lane, whose deferral reason is
unchanged and now stronger: §3 just moved that lane off the primary control, and renaming an
instruction while the thing it points at keeps its name is the worse of the two defects
(`productName.test.ts` still fixes the exception list and its size).

**Dead / duplicated CTA:** none found on the three first-connect paths after §3. The duplicated
「텍스트로 직접 진행하기」 / 「직접 진행하기」 pair is gone by unification.

---

## 6. Agent runtime readiness — and the pilot run procedure

**Lifecycle owner exists.** `docker-compose.yml` owns all four processes; `agent-runtime` declares
`depends_on: backend (healthy)` and `frontend` depends on it. `docker compose up --build` starts
Postgres → backend → agent-runtime → frontend. **No pilot seller runs `npm` or a terminal command
to raise 8787** — that is a property of our local dev path, not of the packaging.
**Not a `PILOT_BLOCKER`.**

**What is missing is not a launcher, it is the deployment's configuration** (§2-C). The procedure
below is the operator-facing thing §6 asked to be fixed in docs. **Names only — no value, key,
secret or IP is recorded in this repository.**

### 6-1 Operator run procedure (pilot host)

1. **Provision** the single 24-hour host with a **fixed public IPv4** and a **fixed public HTTPS
   callback URL**, per `docs/sellerops_local_to_pilot_connectivity_decision.md` §2.3. That
   document records this as **미프로비저닝** and this package does not change that.
2. `cp .env.example .env` and add, on top of what that file already carries:
   - `SELLEROPS_SEED_ENABLED=false` — **only after §2-A lands**; today this name does not exist.
   - `SELLEROPS_VAULT_MASTER_KEY`, `SELLEROPS_VAULT_KEY_ID` — without these no credential can be
     sealed and every connection fails closed.
   - `SELLEROPS_CONNECTOR_CAFE24_ENABLED=true`, `_CLIENT_ID`, `_CLIENT_SECRET`, `_API_VERSION`,
     `_REDIRECT_URI` (the fixed HTTPS callback from step 1), `_RESULT_URL`.
   - `SELLEROPS_CONNECTOR_NAVER_ENABLED=true` and
     `SELLEROPS_CONNECTOR_NAVER_ADVERTISED_EGRESS_IPS` = the host's fixed IPv4 from step 1 — this
     is the value the connect screen tells the seller to register, and a local IP must never
     appear there.
   - `SELLEROPS_CONNECTOR_COUPANG_ENABLED=true` (+ its live-approval id per the live contract).
   - `SELLEROPS_JWT_SECRET` — a long random value, not the example.
   - the backend LLM capability keys, for any AI surface to answer at all.
3. `docker compose up --build`. Verify `/health` on the backend and that `/agent` does **not**
   render 「AI 도우미를 시작하지 못했습니다.」 (that notice is the runtime-down state, §11 of the
   previous package).
4. **After** the seller signs up and connects: add their organization UUID to
   `SELLEROPS_SELF_PILOT_ORG_IDS`, set `SELLEROPS_SELF_PILOT_ENABLED=true`, restart. Without this
   step nothing collects a second time (§2-B). Add the same UUID to `SELLEROPS_PROACTIVE_ORG_IDS`
   only when the seller should get 「AI가 먼저 확인한 일」.
5. Marketplace WRITE stays governed by `docs/sellerops_live_approval_contract.md`. Nothing in this
   procedure grants it.

---

## 7. First pilot live-proof manifest — template, not a run

Nothing here has been executed. This is the checklist to fill in when the first real seller is
chosen, so that their ordinary first connection also lands as the proof
`docs/disconnected_channel_onboarding_v1.md` could not produce. **No account, mall id, credential,
IP or approval value goes in this repository** — the manifest records shapes and outcomes.

| field | to record |
|---|---|
| seller / org | organization UUID only (never the shop name, email or mall id) |
| chosen channel | one of NAVER / Coupang / Cafe24 · and why it was that one |
| starting state | every channel `DISCONNECTED`, asserted before anything is pressed |
| connection / auth step | which step the seller performed themselves; whether the helper lane was offered or taken |
| marketplace READ budget | the ceiling agreed before the run, and the count actually made |
| marketplace WRITE | **0** — asserted, not assumed |
| initial acquisition | which data types ran; terminal `SyncRun` status and `successRows` per type |
| coverage / freshness | the `ChannelDataState` per channel × data type at the end |
| source summary | the sentences the completion card actually rendered (§6/§7 of the previous package) |
| first briefing | the home sentence, and whether it counted or said there is nothing |
| first deterministic command | which chip / phrase, and the object it returned |
| free-text Agent command (optional) | the goal, planner calls, tool calls, `stopReason`, WRITE 0 |
| rollback / disarm | how the connection is revoked, and what remains after |
| seller observation notes | where they hesitated, what they asked, what they expected to see |

Two rules the manifest inherits and does not restate: the run needs a **fresh, single-use, in-turn
approval** (`docs/sellerops_live_approval_contract.md`), and a **WRITE needs its own** mode-`WRITE`
approval, which this manifest never carries.

---

## 8. Verdict

| surface | verdict | why |
|---|---|---|
| signup / login | **READY** | `POST /api/auth/signup` creates a clean org (measured 0 accounts / 0 inquiries / 0 reviews); both forms render with no jargon and no prefilled account outside `?demo=1` |
| first channel connection | **BLOCKED** | connectors default off and the vault fails closed on the documented compose path (§2-C); the Cafe24 callback host is unprovisioned |
| first acquisition | **READY_WITH_OPERATOR** | the flow exists and is offline-proven end to end; a **second** collection needs an env edit + restart per seller (§2-B) |
| source truth | **READY** | `ChannelDataState` + terminal `successRows`; ZERO ≠ UNPROVEN ≠ BLOCKED ≠ NOT_SUPPORTED holds on screen |
| Home briefing | **READY** | arithmetic, no model call, disconnected state measured and correct (§4) |
| Inquiry workflow (draft) | **READY** | draft → evidence → 초안 복사 works with no marketplace WRITE |
| Inquiry workflow (send) | **BLOCKED** | Cafe24 answer execution is implemented but `TEST_INQUIRY_REQUIRED`, needs the seller's separate write re-consent, a configured `client_ip`, and an approved live run |
| Knowledge gap flow | **READY** | V79 applied; save → reindex → retrieve → regenerate |
| Answer Style | **READY** | V80 applied; absent row is the normal state and answers with shipped defaults |
| Human Approval | **READY_WITH_OPERATOR** | the boundary is intact and enforced; it currently gates an execution lane that is itself blocked |
| Agent command | **READY_WITH_OPERATOR** | deterministic palette needs nothing; free-text needs the runtime up, which the compose path owns |
| runtime packaging | **BLOCKED** | no provisioned host, fixed egress IP or public callback exists (`sellerops_local_to_pilot_connectivity_decision.md` §2.3: 미프로비저닝) |

## **NOT_PILOT_READY**

### The P0 list, and nothing else

1. **A pilot deployment seeds `demo@sellerops.ai` / `demo1234` and cannot be told not to.**
   `sellerops.seed.enabled` has no environment placeholder. One line, then set false on the host.
2. **No provisioned pilot host.** A fixed public IPv4 (NAVER 호출 IP) and a fixed public HTTPS
   Cafe24 callback are both required before any seller can connect, and neither exists.
3. **No pilot configuration.** All three connectors default off, the vault fails closed with no
   master key, and `.env.example` names none of it. §6-1 is the procedure; it has never been run.
4. **Routine collection is off by default and is a per-seller env edit + restart.** Without step 4
   of §6-1 the product collects once and then stops.
5. **The pilot has no send lane.** Answering a customer means the seller copies the draft into
   their own channel. That is honest and it works — but if the pilot's success criterion includes
   sending, it is blocked (`TEST_INQUIRY_REQUIRED`, write re-consent, `client_ip`, live approval).

Everything else found in this package was either fixed (§3, §4, §5) or is P1/P2 and is in §10.

---

## 9. What changed, in files

`frontend/` only. Backend source **0**. Migrations **0**.

| file | change |
|---|---|
| `components/guidedConnection/NaverIssuanceGuidedWalkthrough.tsx` | start gate offers both paths, manual primary; fallback promoted above the pairing panel; one label |
| `components/guidedConnection/NaverIssuanceModeChoice.tsx` | text primary, guided ghost + (도우미 필요) |
| `components/coupang/CoupangIssuanceGuidedWalkthrough.tsx` | start gate offers the checklist directly, manual primary; one label |
| `lib/guidedConnection/copy.ts` | the sentence naming the old label |
| `lib/firstConnectionState.ts` *(new)* | `hasAnyConnectedChannel` |
| `components/ui/Metric.tsx` | `beforeFirstConnection` — the plainer sentence, in muted |
| `pages/app/Overview.tsx` | derives and passes it |
| `pages/Cafe24Connect.tsx` · `Cafe24Tutorial.tsx` · `Cafe24ConnectResult.tsx` | `/settings/channels` → `/connect` |
| 3 new test files · 8 updated | see §11 |

---

## 10. Reported, not changed

1. **§2-A, §2-B, §2-C** — the three configuration/seed blockers above. All are backend or
   deployment decisions; none was made here.
2. **The wall of zeros** on the disconnected home. Hiding sections before the first connection is a
   Home redesign, which §9 of the gate forbids.
3. **「SellerOps 도우미」** stays on the NAVER / Coupang helper lane. Unchanged reason, and §3
   reduced its blast radius by taking it off the primary control.
4. **NAVER's completion screen has no live render** — on a connected account `/connect/naver`
   calls the NAVER connection test, so it cannot be captured read-only.
5. **Staged planner progress** still needs a new protocol (id-first start or SSE). Not built.
6. **The Coupang start gate's 이미 키가 있어요** remains a third control on a first screen. It is
   the right escape for a seller who already issued a key and it was not touched.
7. **`AgentPairingPanel`'s own copy** ("도우미를 실행한 뒤 다시 시도해 주세요") is unchanged. It
   is shared with review import, and after §3 a first-connect seller only reaches it by choosing
   the helper lane on purpose.

---

## 11. Counts

- Frontend **188 test files / 2,435 tests / 0 failures**; `tsc --noEmit` clean.
- New tests: `firstConnectionState.test.ts` (5), `Metric.beforeFirstConnection.test.tsx` (2),
  `helperFreeFirst.test.tsx` (3). Updated: 8 files, every rewritten assertion keeping the property
  it was written for and stating the one that changed.
- Browser measurement (Playwright 1440×900@2×, disconnected org, read-only): AA text-node
  violations **0** on all five captures, horizontal overflow **0**, console errors **0**,
  **off-host requests 0**.
- **Marketplace calls 0 · marketplace WRITE 0 · model calls 0 · DB row changes 0 · migrations 0**
  ⇒ no `docs/evidence/INDEX.md` row.
