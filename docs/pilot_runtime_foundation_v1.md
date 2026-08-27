# Pilot Runtime Foundation v1

**Status:** 2026-08-27 · closes the runtime/config P0s from `docs/pilot_readiness_gate_v1.md` ·
**no live marketplace run** · marketplace calls **0** · marketplace WRITE **0** · model calls **0** ·
migrations **0**

> **What this is.** Not a product feature package and not a UX package. The Readiness Gate found
> five things standing between a first external seller and a working product; four of them were
> configuration and lifecycle, and this closes those. It also corrects two claims that gate made
> which were wrong.

---

## 0. Readiness corrections

### 0-A. "Inquiry workflow (send) = BLOCKED / 전송 lane 없음" — **wrong, withdrawn**

I read this repository's `InquiryReplyCapabilityRegistry` docblock ("implemented … has never been
exercised against a real marketplace") and CLAUDE.md's Cafe24 summary (`TEST_INQUIRY_REQUIRED`), and
reported from them. Both were written **before** the sends happened. `CLAUDE.md` says to re-derive
state at the current commit before citing, and I did not.

**Two channels have a live-verified marketplace answer:**

| | proof | what was observed |
|---|---|---|
| **Cafe24 문의** | `VERIFIED`, 2026-08-25, commit `b0bfb022`, `docs/inquiry_answer_execution_v1.md` §30 | `POST /boards/6/articles` **once**, no retry; child article created; verification by **exact READ**, not by 2xx — child exists, parent matches, thread role is REPLY, normalised body hash == the approved draft, parent `reply_status == C` |
| **NAVER 상품 문의** | `LIVE_VERIFIED`, 2026-08-26, commit `692c5a78` | `PUT /external/v1/contents/qnas/{questionId}` **once**, retries 0, duplicates 0; approval `mode WRITE, max 1` spent and not reused; verdict from the system's own read-back (`NaverAnsweredStateReader` reopened the window and recorded `observed_status=ANSWERED`), never from the HTTP status |

Both also record something the gate would have missed either way: the sent text was **not** the AI
draft. Draft v1 (`MODEL`) was preserved and did not go out; the seller's edited v2 (`SELLER`) was
what was approved, sent and verified.

### Per-channel execution readiness (§9)

| channel | execution capability | live proof | default enablement | required flags | approval boundary | pilot usability |
|---|---|---|---|---|---|---|
| **Cafe24 문의** | `Cafe24ChannelReplyAdapter` → `POST /boards/{n}/articles` (a reply is a **child article**) | **`VERIFIED`** 2026-08-25 | **off** | `…PUBLISH_EXECUTION_ENABLED` · `…CAFE24_LIVE_APPROVAL_ID` · `…CAFE24_CLIENT_IP` · `…CAFE24_SHOP_NO` · the seller's own `mall.write_community` re-consent | Human Approval → Action Executor; the armed approval id is an **environment binding**, not a substitute for the seller's approval | **SUPPORTED** |
| **NAVER 상품 문의 (Q&A)** | `NaverProductQnaReplyAdapter` → `PUT /v1/contents/qnas/{questionId}` | **`LIVE_VERIFIED`** 2026-08-26 | **off** | `…PUBLISH_EXECUTION_ENABLED` · `…NAVER_LIVE_APPROVAL_ID` | same, plus the subtype is bound into the approval and re-checked before the send | **SUPPORTED** |
| **NAVER 고객 문의 (네이버페이)** | `NaverCustomerInquiryReplyAdapter` → `POST /v1/pay-merchant/inquiries/{inquiryNo}/answer` | **none** — implemented, never exercised | off | as above | as above | **OPERATOR_ASSISTED** — the endpoint refuses an already-answered inquiry (`ERR-NC-101010`), which is the safer of the two contracts, but "safer" is not "proven" |
| **Coupang 문의** | `CoupangChannelReplyAdapter` → `POST …/onlineInquiries/{id}/replies` | **none** — implemented, never exercised | off + its own connector flag | `…PUBLISH_EXECUTION_ENABLED` · the Coupang connector flag | as above | **OPERATOR_ASSISTED** |
| **Coupang 리뷰** | none, and none is planned | — | — | — | — | **NOT_SUPPORTED** — Coupang has no seller review-reply feature; the capability table says so |
| **NAVER 리뷰** | none in this lane | — | — | — | — | **NOT_SUPPORTED** for direct send |

**No new marketplace WRITE proof was made in this package.** The two verified lanes were read out of
the record, not re-run.

The identifier spaces are why these are four rows and not one: NAVER's two subtypes are both bare
int64s in non-overlapping spaces, so an approval spent on the wrong one would not fail — it would
answer a different customer's question.

### 0-B. Cafe24 fixed HTTPS callback — **not new infrastructure, but not reusable either**

Audited rather than assumed. Two things exist and neither is the pilot callback:

- **`tools/cafe24-callback`** is a dev receiver whose README says, in its own words, that it is not
  the product callback: it confirms `code`/`state` arrived as booleans and **does not exchange the
  code**. The product endpoint `GET /api/connect/cafe24/callback` is the one that exchanges and
  persists. It cannot stand in for the product flow, and its `vercel/` option deploys the same
  non-exchanging function.
- **`docs/sellerops_local_to_pilot_connectivity_decision.md`** §2.2 is a *decision* to keep a fixed
  public callback. §2.3's production items are recorded there as **미프로비저닝**, and the Cafe24
  first-connection live proof states the callback arrived "via the operator's public tunnel" — an
  operator-run tunnel, not a fixed deployment.

**So no new callback infrastructure is authorised or built here.** What is required is a stable
public HTTPS hostname in front of the existing backend endpoint. A named, stable tunnel hostname
satisfies the byte-identical requirement as well as a load balancer does; an ephemeral
`trycloudflare`-style URL does not, because the registered redirect URI, the authorize URL and the
token exchange must all be the same string. Which of the two the pilot uses is an operator decision
and §10 records it as the one genuinely missing piece.

---

## 1. Readiness definition

The target of this package is **`OPERATOR_ASSISTED_PILOT_READY`**, not self-serve production. For
the first 3–5 sellers an operator may configure, connect and watch. Five things operator assistance
cannot cover, and all five are treated as P0 here: a known default credential, collection that does
not continue, credential/secret safety, a required runtime that is not up, and any seller/org
isolation error.

---

## 2. Demo account security

`MockDataSeeder` was doing three different jobs behind one flag that defaulted **on**. Split, with
the defaults each of them deserves:

| group | flag | default | what it is |
|---|---|---|---|
| Channel catalogue (13 rows) | `sellerops.seed.channel-catalogue` | **true** | product reference data — the only producer of `channels` rows in this repository; without it 채널 연결 has nothing to offer |
| Demo organisation (데모 제조사 + `demo@sellerops.ai` + 2 accounts) | `sellerops.seed.enabled` | **false** | a fixture whose user's password is written down in this repository |
| Demo content | `sellerops.seed.demo-content` | false | nested inside the demo organisation |

`sellerops.seed.enabled` was previously hardcoded `true` with no environment placeholder — it could
not be turned off at all. It is now `${SELLEROPS_SEED_ENABLED:false}`.

**Nothing was deleted.** Set `SELLEROPS_SEED_ENABLED=true` and the fixture seeds exactly as before;
the catalogue is idempotent, so a demo boot after a catalogue-only boot attaches its accounts to the
rows that already exist rather than writing a second catalogue.

**The login shortcut follows the deployment, not the URL.** `/login?demo=1` used to prefill
`demo@sellerops.ai` / `demo1234` purely on the query string. It now asks
`GET /api/auth/demo/config` — one boolean, never an account — and prefills only on an explicit
`true`. `null` (still asking) counts as no, so a slow or unreachable backend renders no way in
rather than a way in that does not work. The public header and the landing CTAs use the same answer;
the notice that says "the form is prefilled" renders only where it actually is.

The catalogue got its **own** flag rather than running unconditionally because several tests own the
`channels` table and had been suppressing it via `seed.enabled=false`. "No demo data" and "no product
reference data" were never the same request, and now they are not the same switch.

---

## 3. Environment contract

`.env.example` carries **names only** and its purpose is stated in it: *copying it must produce a
deployment that runs safely, not one where every connector is switched on*. Every connector stays
`false` there. `docker-compose.yml` now passes each of those names through to the backend container
with the safe default, so the file and the running stack agree.

Covered: DB · vault master key + active key id · NAVER enable + advertised fixed IP · Coupang enable
+ live approval id · Cafe24 enable + client id/secret + API version + redirect URI + result URL ·
routine-collection scope and cadence · proactive flags · answer-execution flags · agent-runtime
app env / run store / CORS / the browser's runtime URL.

No API key, secret, IP or credential value is committed.

---

## 4. Startup fail-closed validation

`PilotConfigValidator` — one class, one list of conditions, checked at `ApplicationReadyEvent`, each
condition chosen because it produces a **half-working runtime** rather than an error:

| condition | why it is not a warning |
|---|---|
| any connector on + no vault master key | every credential save fails closed **after** the seller's consent, on the last screen |
| NAVER on + no advertised egress IP | the connect screen tells the seller to register "SellerOps 고정 호출 IP" — a value this deployment then cannot name, and the first order sync fails on call IP |
| Cafe24 on + no client id/secret | the consent cannot begin |
| Cafe24 on + callback missing / non-HTTPS / still the loopback default | the registered URI, the authorize URL and the token exchange must be byte-identical and the exchange reads this property — so the consent cannot complete anywhere, including on the developer's own machine |

**A connector that is OFF demands nothing.** A deployment that does not talk to Coupang starts
perfectly with no Coupang configuration; treating that as a fault would make the honest default
posture unbootable. The message names the environment variable and nothing else — a test asserts it
carries no value.

No configuration framework, no schema, no registry.

---

## 5. Routine acquisition — the root cause

**Channel connection → initial acquisition → recurring acquisition is ordinary Seller Operations, not
an AI feature.** The audit found the machinery already correct and the *scope* wrong.

`SelfPilotReconciler` already creates a default schedule for every CONNECTED, non-file-upload seller
account whose channel resolves to a dedicated connector with a `CONFIRMED` capability, only when no
schedule row exists, immediately due. It is idempotent, restart-safe, and already per-org
try/catch. Nothing about that needed changing.

What decided *which orgs* it ran for was `SelfPilotProperties.Scope`, and it had two values:
`ALLOW_LIST` (an env list of UUIDs) and `LOCAL_SINGLE_USER` (every org, and it **refuses to boot**
unless the database host is loopback). A pilot is neither: it is multi-tenant and it is not on
localhost. So every new seller cost an env edit and a backend restart.

---

## 6. Recurring collection v1

A third scope, `CONNECTED_SELLERS`, reading its targets from the database the product already has:

```
select distinct a.orgId from SellerAccount a
 where a.connectionStatus = CONNECTED and a.fileUpload = false
```

**It needs no loopback fence because it is not "every org" — it is every org that asked.** A seller
account reaches `CONNECTED` only by that seller completing an OAuth consent or entering a
credential, and connecting a channel is the instruction to collect it. An org with no connected
account is not a target, so an empty database still acts for nobody, and an org drops out when its
last account stops being connected — self-healing, with no second list to keep in step with the
first.

No new job platform, no queue, no workflow engine, no new scheduler. One enum value, one repository
query, one branch.

---

## 7. Collection safety

Unchanged, and unchanged deliberately: routine collection is READ only; single-flight, rate budget,
channel safety, freshness and cursor contracts are the same objects they were; marketplace
customer-facing WRITE stays 0. The per-org `try/catch` in the reconciler already meant one seller's
failure does not stop the tick — §15-G now pins that against the scope that makes the org list long.

---

## 8. The Proactive Agent stays separate

Turning routine collection on does **not** turn proactive preparation on. `sellerops.proactive.enabled`
defaults false and its `@ConditionalOnProperty` means the bean does not exist; its targets start
from **its own explicit org list** and the intersection with the routine scope can only narrow that
list, never widen it into "every connected org". Pinned by `ProactiveSeparationTest`, including a
source-level assertion on the conditional and a config assertion on both shipped defaults.

*Data stays fresh* is the baseline. *An agent creates work* is a separate choice.

---

## 9. Per-channel execution readiness

See §0-A. Summary: **SUPPORTED** Cafe24 문의 · NAVER 상품 문의. **OPERATOR_ASSISTED** NAVER 고객 문의 ·
Coupang 문의. **NOT_SUPPORTED** Coupang 리뷰 · NAVER 리뷰 direct send.

The pilot's success criterion is **not** "direct send on every channel". Where a channel is
supported the loop is Human Approval → the existing Action Executor. Where it is not, the truthful
fallback is the seller copying the draft into their own channel — which is what the inquiry screen
already offers, and which is not a degraded mode but a different one.

---

## 10. Infrastructure

Repository-verifiable state, nothing provisioned here and no cloud resource created:

| requirement | state |
|---|---|
| Fixed outbound IPv4 (NAVER 'API 호출 IP') | **missing.** The backend makes NAVER calls on the JVM's default outbound socket — no proxy, no egress pinning, no config key — so the egress IP is whatever the host's NAT is. The value shown to sellers comes from `SELLEROPS_CONNECTOR_NAVER_ADVERTISED_EGRESS_IPS` and must be that host's real fixed address. |
| Cafe24 public HTTPS callback | **missing as a deployment.** The endpoint exists and is live-proven; what does not exist is a stable public hostname in front of it (§0-B). |
| backend / frontend / agent-runtime topology | **exists as compose** (§11); no host is provisioned to run it. |

**Minimum topology** — one 24-hour host with a fixed public IPv4 and one DNS name with TLS,
running the four compose services, plus a Postgres volume that survives a redeploy. **Operator
steps** — provision the host; point the DNS name at it; terminate TLS; register that name's
`/api/connect/cafe24/callback` as the Cafe24 redirect URI; fill `.env` per §3; verify the actual
egress IP equals the advertised one across host/container/reboot/redeploy. **Whether to provision
that host, and whether a named stable tunnel is acceptable in its place for 3–5 sellers, is a
product-owner decision** and is not made here.

---

## 11. Agent runtime

The compose lifecycle proof holds: `docker compose up --build` starts Postgres → backend (health
gate) → agent-runtime → frontend, and **no seller ever needs `npm`, `tsx` or the number 8787**.

**One real defect found and fixed.** `VITE_AGENT_RUNTIME_URL` is baked into the frontend bundle at
build time, and the frontend `Dockerfile` had **no build arg for it** — so every image resolved the
code default `http://127.0.0.1:8787`. On a remote pilot host that points the seller's browser at
**the seller's own computer**, and the /agent lane fails for everybody with
「AI 도우미를 시작하지 못했습니다.」 — a runtime-configuration failure wearing the costume of a broken
product. It is now an `ARG`/`ENV` in the Dockerfile and a build arg in compose, defaulting to the
same published port so a local stack is unchanged. The CSP `connect-src` already derived from the
same variable, so it follows.

---

## 12. Operator-assisted pilot runbook

No credential value belongs in this list. Each step's check is something the operator can read.

| # | step | what tells you it worked |
|---|---|---|
| 1 | Pilot runtime health | `GET /health` is `UP`; the stack came up without the §4 refusal; `/agent` does not show 「AI 도우미를 시작하지 못했습니다.」 |
| 2 | Seller signup | a new organisation exists with 0 accounts, 0 inquiries, 0 reviews |
| 3 | Channel connection | the seller performs the OAuth consent or credential entry themselves; the account reaches `CONNECTED` |
| 4 | Initial sync | the completion card names what was fetched — the numbers come from the terminal run, never from stored rows |
| 5 | Routine acquisition | with `SELF_PILOT_SCOPE=CONNECTED_SELLERS` this needs **no env edit**: schedules appear on the next reconcile tick, due immediately (§13 query 2) |
| 6 | Source summary | 「가져왔습니다」 / 「없습니다」 / 「아직 확인하지 못했습니다」 — the state decides the sentence, the run decides the number |
| 7 | First briefing | the home sentence is arithmetic over the objects rendered under it; no model is called |
| 8 | First deterministic command | a command-palette chip returns a workspace object, `navigate` 0, run 0 |
| 9 | Optional free-text command | `/agent`; planner 1 call, tools READ only, `stopReason: COMPLETE`, marketplace 0 |
| 10 | First inquiry draft | a draft with its evidence, and one of the three answer states on the card |
| 11 | Approval / send capability | supported channel ⇒ Human Approval → Action Executor (its own armed approval id); unsupported ⇒ 초안 복사 and the seller posts it |
| 12 | Logs / rollback | §13 queries; to stop collection, disable the schedules — the connection itself is revoked by the seller in their own marketplace |

Live-run governance is unchanged and is not restated here: `docs/sellerops_live_approval_contract.md`.

---

## 13. Observability

No new platform, no new table, no new endpoint. Five reads answer "is it stopped?", all verified
against the local database:

1. **Connected accounts and the orgs behind them** — `seller_accounts where connection_status='CONNECTED' and is_file_upload=false`, `count(distinct org_id)`.
2. **Per account × data type: is it scheduled, is it paused, when next, when last successful** — `sync_schedules` left-joined to `sync_jobs` (`max(finished_at) filter (where status='SUCCESS')`). This is the one an operator reads first: a row with `enabled=t` and a stale `last_success` is the shape of "it stopped".
3. **Failures vs successes in the last 24h** — `sync_jobs` by `status` and `finished_at`.
4. **Work the seller owes, and what was prepared for it** — unanswered REAL inquiries (the existing operational predicate), `inquiry_reply_draft`, `inquiry_execution`.
5. **Agent runs** — `agent_runs`.

Measured on the local database while writing this: connected accounts 4 · orgs 2 · enabled schedules
8 · runs in 24h 23 success / 15 failed · drafts 11 · executions 3 · agent runs 0.

---

## 14. No new UX work

Home, Inbox, Style and Onboarding are visually unchanged. The only frontend behaviour that moved is
the demo entry (§2), which is a correctness issue: a screen offering a way into an account the
deployment did not create is showing a false state.

---

## 15. Regression

| | property | where |
|---|---|---|
| A | default boot creates no known demo account | `MockDataSeederTest.fixtureDisabled_seedsTheChannelCatalogueAndNoAccount` |
| B | explicit `seed.enabled=true` seeds the fixture exactly as before, reusing the catalogue | `fixtureEnabledAfterCatalogueExists_reusesTheCatalogue`, `catalogueIsIdempotentAcrossBoots` |
| C | a non-demo deployment renders no demo shortcut and prefills nothing — including while the answer is outstanding | `demoEntryFence.test.tsx`, `Login.demoEntry.test.tsx` |
| D | a connected seller is a routine-collection target | `connectedSellersReadsItsTargetsFromTheConnectedAccounts` |
| E | a newly connected seller collects again with no env edit and no restart | same test — the targets are a query, not a config value |
| F | proactive OFF leaves routine acquisition running; the widest routine scope gives proactive nothing | `ProactiveSeparationTest` |
| G | one org's failure does not stop the others | `oneOrgFailingDoesNotStopTheRest` |
| H | a connector that is OFF never causes a boot failure | `PilotConfigValidatorTest.everyConnectorOff_bootsWithNoSecretsAtAll`, `oneConnectorOn_doesNotDemandAnotherConnectorsConfiguration` |
| I | a connector that is ON with required config missing fails closed and actionably | `anyConnectorOnWithNoVaultKey_isRefused`, `naverOnWithNoAdvertisedEgressIp_isRefused`, `cafe24OnWithNoAppCredentials_isRefused`, `cafe24CallbackMustBeAReachableHttpsAddress` |
| J | marketplace WRITE 0 | no marketplace call was made in this package; the two verified sends were read out of the record, not re-run |

Backend **3,450 tests / 0 failures / 23 skipped**. Frontend **190 files / 2,441 tests / 0 failures**;
`tsc --noEmit` clean.

---

## 16. Verdict

## **NOT_PILOT_READY**

Four of the Readiness Gate's five P0s are closed. **One is not, and it is not a code problem.**

### P0 — blocks the first seller

1. **No provisioned pilot host.** A fixed public IPv4 (NAVER 호출 IP) and a stable public HTTPS
   Cafe24 callback are both required before any seller can connect, and neither exists (§10). This
   is the whole remaining blocker; §10 records the minimum topology and the operator steps, and
   whether to provision it — or accept a named stable tunnel for 3–5 sellers — is a **product-owner
   decision**.

### P1 — do before the first seller, not blocking the build

- Run `docker compose up --build` once against the completed `.env` on the target host and confirm
  the §4 validator passes. It has never been executed on a provisioned host, because there is none.
- Set `VITE_AGENT_RUNTIME_URL` for that host (§11); the default is correct only on localhost.
- Decide whether the pilot's success criterion includes direct send. If it does, the two
  `OPERATOR_ASSISTED` channels (NAVER 고객 문의, Coupang 문의) need a first live send each.

### Not blockers

- Direct send being unavailable on every channel. Two are live-verified; where a channel has no
  send lane, copying the draft is a truthful fallback, not a failure (§9).
- The wall of zeros on a disconnected home, and the remaining helper-lane naming — both P2, both
  recorded in `docs/pilot_readiness_gate_v1.md` §10.

**What a first seller gets today, on a provisioned host:** connect → initial acquisition → routine
refresh with no operator touch → a home briefing that counts real work → an inquiry drafted with its
evidence → approve and send on Cafe24 or NAVER 상품 문의, or copy the draft elsewhere. That loop is
complete. The host it runs on is not.
