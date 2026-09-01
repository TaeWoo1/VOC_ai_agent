# Pilot Readiness Closure v1

2026-09-01. Scope: `backend/` (an access policy, two fences the pilot posture tripped over, the boot
validator), `agent-runtime/` (two interaction contracts), configuration (`application.yml`,
`docker-compose.yml`, both env examples) and one development instrument (`tools/dev/org-cleanup.sh`).
**Agent and conversation architecture are frozen**: the deterministic lanes, scope rules, planner
contract, approval boundary and marketplace-write fences are the ones `agent_object_first_use_v1.md`
left, and nothing here touches them.

One question: **can a new seller be added to the pilot without a developer editing an environment
file or restarting a server?** The audit said no, four times, and two of the four were worse than
"inconvenient" — they were a deployed host on which the product does not run at all.

**Marketplace calls 0 · marketplace WRITE 0 · migrations 0.**

---

## §1 The audit

| # | Asked about | Found |
|---|---|---|
| 1 | `SELLEROPS_AGENT_PLAN_ORG_IDS` manual allow-list | **Real.** Admitting one seller meant pasting their org UUID into three env vars and restarting the backend — with every other seller's conversations and runs going down with it. The only alternative the repository offered was `*`, whose own docblock calls it the local single-user posture and says never to use it on a shared backend. §2. |
| 2 | `PilotConfigValidator` boot failure on a plain `.env.local` | **Not a defect, and one real thing beside it.** The validator refusing a deployment whose Cafe24 connector is on with a loopback callback is the validator working. What it did NOT say was that turning the connector off is also a way forward, and it said nothing at all about an AI capability switched on that can reach nobody. §4. |
| 3 | per-org planner / draft / judge enablement | **One path, three copies.** Each capability rightly keeps its own flag and key (they are different exposures), but "which organisations" was answered three times in three env vars. §2 answers it once. |
| 4 | conversation / run-store / knowledge / approval across a restart | **Two P0s.** The production run store refused the CONVERSATION domain outright (§7), and knowledge/approval are ordinary org-scoped tables that were never at risk. §9-6 measures the restart. |
| 5 | QA cleanup org scope safety | **No instrument existed.** Forty organisations had accumulated in the local database, beside the canonical Demo Org, and the only cleanup available was hand-written DELETEs. §5. |

Two more surfaced while proving the above, and both are §1-class:

* **§7 — the chat product could not run on any deployed host.** `APP_ENV=production` requires the
  backend-owned run store, the pilot compose sets exactly that, and the backend's allowed-domain list
  did not contain `CONVERSATION`. Every conversation, on every deployed host, was a 400 at create.
* **§8 — a channel with its connector off did not stop collecting; it started inventing.**

---

## §2 Who may use the Agent — a named policy, not a development shortcut

`sellerops.agent.access.scope` (`SELLEROPS_AGENT_ACCESS_SCOPE`), one deployment-level value:

| value | who is admitted |
|---|---|
| `ALLOW_LIST` **(default)** | exactly the org ids in each capability's own list — byte-identical to the behaviour before this property existed |
| `CONNECTED_SELLERS` | any org that owns a CONNECTED, non-file-upload seller account |
| `ALL_ORGS` | every org in this backend — the honest name for what a bare `*` meant |

`CONNECTED_SELLERS` is the pilot's value, and it is not a new idea: it is the sentence
`SellerAccountRepository#findOrgIdsWithConnectedApiAccount` already uses for routine collection.
**A seller reaches CONNECTED only by finishing an OAuth consent or entering a credential, so this is
not a guess about who wants the product — it is the record of who asked.** It also fences the hazard
`*` cannot: an organisation created by a drive-by signup on a public host has connected nothing and
therefore spends nothing.

**The policy only ever widens, and only the organisation question.** `isDeployed()` — the flag and
the key — is checked first and no scope overrides it, so a capability this deployment has not
configured stays off for everyone. An org named in a capability's own list stays admitted under every
scope. A misspelled scope is refused at construction rather than silently becoming one of the two
values that would be wrong in opposite directions.

The split that makes this possible is `AgentCapabilityGate`: a deployment-level question
(`isDeployed`) and an organisation-level one (`isConfiguredFor`), where there used to be one boolean.
`isEnabledFor` is still exactly their conjunction, so nothing moved by being split.

**Scope of the change: plan, draft and judge.** Those are the three the seller's own sentence needs.
The review triage pilot, the inquiry signature classifier and the image-knowledge lane keep the
explicit allow-list — each has its own rollout status (image knowledge is recorded `DEFERRED`), and
silently widening a capability nobody asked to widen is the kind of decision this repository
surfaces rather than makes.

### §2-A When the answer is no, the sentence says whose move it is

An org that has connected nothing used to be told 「AI 계획 기능이 꺼져 있어…」 — true about the
deployment, useless to the seller, and on a fresh pilot account it is the FIRST thing the product
says. The plan endpoint now carries `unavailableMessage`, a field separate from `quotaMessage`
because the runtime reads a quota message as AGENT_QUOTA_EXHAUSTED and no ceiling was met here. The
failure classification is unchanged; only the sentence differs:

> 판매 채널을 연결하시면 AI 운영 담당자가 함께 일을 시작합니다. 연결 전에도 홈·문의·리뷰 화면은 평소대로 사용하실 수 있습니다.

The two operator-side refusals carry no seller sentence at all — the runtime already has one honest
sentence for "the capability is off", and a second version of that promise is worse than none.

---

## §3 The names the container could not see

`docker-compose.yml` passed **no** `SELLEROPS_AGENT_*` variable into the backend container, and
neither `.env.example` nor `deploy/pilot/pilot.env.example` named one. An operator following the
pilot runbook exactly would produce a host where the planner is off, the Agent fails on every free
sentence, and nothing anywhere says which variable to set. Both examples now name them (names only),
and compose passes them through.

**The model overrides are deliberately NOT passed through.** `KEY: ${KEY:-}` sets the variable to the
empty string inside the container, and an empty `SELLEROPS_AGENT_PLAN_MODEL` would silently blank the
configured model rather than fall back to it.

---

## §4 A capability that is on and can reach nobody is a boot failure

`PilotConfigValidator` gained one condition per AI capability, in the shape it already used for
connectors — only capabilities that are switched ON are checked, because the honest default posture
must boot:

* enabled with no key ⇒ the call cannot be made at all;
* enabled and keyed, access policy `ALLOW_LIST`, and no organisation listed ⇒ the call can be made
  and nobody may make it. **This is the pilot trap exactly: the operator turned the Agent on and
  every seller still sees it off.**

The validator reads **no capability's property keys**. `AgentDraftBoundaryTest` refuses a file that
reads two capabilities' flags — that is how two exposures become one switch — and it caught the first
version of this change. Each capability now names itself (`capabilityName()` returns its env prefix),
so the validator can check all four while reading none. The failure message also gained the other way
out: 「아래를 채우거나 **해당 기능을 끈 뒤** 다시 시작하세요」.

---

## §5 Deleting one QA organisation, safely

`tools/dev/org-cleanup.sh --org <uuid> [--confirm]`. Dry run by default; one organisation named by
UUID with no "all test orgs" mode, because a rule that decides which organisations are disposable is
a rule that can be wrong about a real one. It **refuses an organisation that owns a CONNECTED,
non-file-upload account** — the product's own predicate for a real marketplace relationship — and it
deletes inside one transaction, so a foreign key it could not reach rolls the whole thing back rather
than leaving an organisation that exists in half the tables. The table list comes from the catalogue
(every table with an `org_id`), not a hand-written list that would go stale at the next migration.

---

## §6 The two interaction contracts

**§6-A Naming a row by its position is the same act as pressing it.** An ordinal over a review list
narrowed the working set and announced 「N번째 리뷰를 골랐습니다」 — the product telling the seller that
something happened somewhere else. It now runs the same deterministic lane a click and 「이 리뷰」 run:
one exact read, the review's own card, the same anchor, no planner. A read that fails keeps the
selection and says the detail could not be loaded, rather than describing a review from the row.

**§6-B `UNKNOWN` was a budget decision, not an honest one.** The deterministic inspect lane hardcoded
`replyCapability: "UNKNOWN"` because it had chosen to make one read, so the reply control never
appeared on the path a seller actually reaches by clicking — while the planner path offered it for
the same review. It now buys the second org-scoped read (the account the review came in on) and
resolves the question through the same `capabilityOf` every other execution decision uses.

**What is still not guessed.** An absent capability view resolves to NOT_SUPPORTED inside
`reviewExecutionOf`, correctly, because that is an execution decision failing closed. This card is a
description, not an execution decision, so a read that answers nothing stays `UNKNOWN`:
「확인하지 못했습니다」 and 「지원하지 않습니다」 are different claims and only one of them was observed.

---

## §7 The run store did not accept the thing the product writes

`AgentRunStoreService` allowed domains `{INQUIRY, REVIEW, ISSUE}` and statuses
`{AWAITING_APPROVAL, DONE}`. The conversation store writes domain `CONVERSATION` with status
`OPEN`/`WAITING_HUMAN`. `APP_ENV=production` **requires** that store — the file store is
single-instance and the memory store loses paused runs — and the pilot compose sets exactly that
pair. So the chat-first product was refused at its first sentence on every deployed host, with a
400 whose message named none of this.

Domain and statuses added. The **sanitization fence stays**, narrowed by exactly three keys and only
for this domain: `turns[].text` is the sentence the seller typed, `turns[].message` is the sentence
reviewnary composed back, and `pendingCapture.candidate.content` is the seller's own answer on its
way to their own knowledge base. **A transcript that cannot hold what the seller typed is not a
transcript.** Everything else stays forbidden for conversations too — body, details, draft, quote,
writer, email, phone, address — and the customer's words are already stripped before a turn is
persisted, which the restart proof in §9 measured. Moving conversations off the unfenced local file
store onto this path leaves them **more** checked than they were, not less.

Measured, not assumed: every conversation the local file store held (40 of them) was walked for
forbidden keys. `text` and `message` collide in all 40, `content` in one, and nothing else in any.

---

## §8 A channel with its connector off must collect nothing

`ConnectorRegistry.resolvePullConnector` fell back to any connector declaring no dedicated channels —
which is `MockApiConnector`, the deterministic offline fixture. So for any channel whose connector
bean is absent (what a disabled connector flag produces), a sync did not fail: it **succeeded**, and
wrote synthesized reviews and inquiries into that seller's tables with `data_origin='REAL'`.

Observed in this package's own QA: a QA organisation with a CONNECTED Cafe24 account and every
connector off collected **60 invented reviews and 45 invented inquiries** in two scheduler ticks.
No marketplace was called — `MockApiConnector` makes no network call and holds no credential — so
this is a data-integrity defect, not an egress one. On a pilot host the shape is: a seller connects
Cafe24, the operator later switches the Cafe24 connector off, and instead of collection stopping the
seller watches invented rows arrive.

`sellerops.connector.mock-fallback.enabled`, default **true** so every local and test deployment is
unchanged (locally the mock is the point), and **false** in `deploy/pilot/pilot.env.example`. The
fence never hides a channel's own connector — that is asserted, not just intended.

---

## §9 Verification

Everything below ran on a **clean pilot-style boot** on this commit: demo seed off, every connector
off, self-pilot off, proactive off, answer execution off, the mock fallback fenced, plan and draft on
with **no organisation named in any allow-list**, access scope `CONNECTED_SELLERS`, and the runtime on
`APP_ENV=production` + `AGENT_RUNTIME_RUNSTORE_KIND=spring` — the posture the pilot compose produces.
Backend boot: 86 migrations validated, none applied, **0 ERROR / 0 WARN**, ready in 7.0s.

| # | Step | Result |
|---|---|---|
| 1 | New org through the product's own signup, nothing connected | Agent run FAILED with the seller's own next step: 「판매 채널을 연결하시면…」 — not 「기능이 꺼져 있습니다」 |
| 2 | The same org after a channel becomes CONNECTED | `DONE`, real artifacts — **no env edit, no restart, the same backend process** |
| 3 | A second new org, still unconnected | still gated; and reading org A's conversation with org B's token is a **404** |
| 4 | The data-bearing org (CONNECTED before this package, named in no list) | `DONE` — 「답변 안 한 문의는 35건입니다」, 35 rows in the working set |
| 5 | Review list → 「두 번째 리뷰 자세히 보여줘」 | the exact `REVIEW_DETAIL` card, `reviewId` equal to row #2's id, anchored, `replyCapability=NOT_SUPPORTED` resolved from the channel's own capability |
| 6 | Backend **and** runtime restarted | conversation reloaded from Postgres with **6 turns**, the review anchor intact, the stored card's `body` **stripped**, and the same thread continued with a new turn |
| 7 | Scoped cleanup | refused the Demo Org (3 connected accounts) and this package's own org A (1); deleted two disposable orgs, 2 rows and 1 row, Demo Org inquiries 3,356 → 3,356 |

Browser QA at **1440 / 1366 / 1152**, on the same stack:

* **first use, no channel** — 「판매 채널을 연결하면 시작할 수 있습니다」 + what connecting hands over + one action;
* **first use, connected and empty** — 「카페24 자사몰 연결은 끝났습니다. 첫 수집이 끝나면…」 (and with §8 fenced this is now genuinely empty rather than filled by the mock);
* **working** — the ordinary brief;
* **review ordinal** — 「두 번째 리뷰 자세히 보여줘」 draws the card (★4 · 카페24 자사몰 · 방수 케이블 커버 화이트 · 2026-08-31) with the customer's sentence, and the context bar names it with 「해제」.

**AA text violations 0 at all three widths · horizontal scroll 0 · console errors 0 · off-host
requests 0.**

Suites: backend **3,613** / agent-runtime **801** / frontend **2,627** · **0 failures** · typecheck
clean on both TS projects.

**Marketplace calls 0 · marketplace WRITE 0 · migrations 0** ⇒ no evidence row.

### What the QA had to fake, and said so

A seller account reaches CONNECTED through an OAuth consent, and there is no safe test mall to
consent against — Pilot Readiness Gate v1 recorded that as `UNPROVEN_BY_NO_SAFE_TEST_ACCOUNT` and it
is still true. So step 2 inserts the row a completed connection writes, directly, with no marketplace
call and no credential. **What is proven is the admission policy that reads that row, not the
connection flow that writes it** — and the connection flow's first real proof is still the first
pilot seller's first connection (§7 of `pilot_runtime_foundation_v1.md`).

---

## §10 What is left

### Live marketplace proof still outstanding

Nothing in this package touched a marketplace, and nothing in it changes the send lanes. The
outstanding external proofs are the ones already on record and are unchanged:

* **Cafe24 inquiry answer** — `VERIFIED` (2026-08-25). **NAVER 상품문의 answer** — `LIVE_VERIFIED`
  (2026-08-26). Both remain the only proven marketplace WRITEs, and both are OFF in the pilot env
  example until their own approval.
* **Cafe24 review comment execution, NAVER guided reply composer fill, Coupang guided acquisition** —
  `IMPLEMENTED · LOCAL_PROVEN · LIVE_UNPROVEN`. No safe live target exists for any of them.
* **A first real channel connection on a deployed host** — the one proof that cannot be manufactured
  here, and the reason §9 says what it faked.

### Pilot provisioning inputs (product-owner / operator, not repository-answerable)

The host itself is still the blocker `pilot_runtime_foundation_v1.md` §10 named, and this package did
not create any billable resource. To stand it up, the following are inputs nobody in this repository
can supply:

1. **A host with a fixed public IPv4 and a DNS name** — `PILOT_PUBLIC_HOST`, `PILOT_ACME_EMAIL`.
2. **A Cafe24 app whose registered redirect URI is byte-identical** to
   `https://<host>/api/connect/cafe24/callback`, plus its client id and secret.
3. **The NAVER advertised egress IP** — this host's address, verified with `egress-check.sh` before
   the connector flag is flipped.
4. **The vendor key for the AI capabilities**, and the decision of **which access scope** the pilot
   runs under. `CONNECTED_SELLERS` is what the env example sets and what §9 proves; `ALL_ORGS` is
   available and admits a drive-by signup on a public host, which is the trade to decide.
5. **Whether signup on the pilot host is open**. It is today. Under `CONNECTED_SELLERS` an unconnected
   signup costs nothing, which is why that scope is the recommendation rather than a preference.
6. **The vendor model.** Every capability still defaults to a snapshot the vendor marks deprecated;
   `planner_model_benchmark_v1.md` measured the candidates and recommended **no change**. Still a
   product-owner decision.

### Reported, not fixed

* **A conversation has no turn cap**, and the run store's snapshot ceiling is 256 KB. The largest
  conversation on disk is 85 KB, so nothing has hit it — but a long-lived thread will, and the
  failure would be a lost turn. Choosing a cap is a product decision (what a seller loses), not a
  number to invent here.
* **The access policy asks the database once per capability check.** An existence query per gate, not
  cached. Negligible at pilot scale; named so it is not discovered later as a surprise.
* **The other three AI capabilities keep the explicit allow-list** (§2). The boot validator now
  refuses a deployment that switched one of them on with no organisation listed, which is the same
  real trap — a behaviour change for a capability this package otherwise did not touch.
* **`MockApiConnector` still exists and is still the default fallback locally.** The fence is
  configuration, not deletion: the mock is what makes the collection backbone testable offline.
* **Synthetic rows written earlier by that fallback are still in the local QA org** (74 reviews,
  60 inquiries, `data_origin='REAL'`). Historical cleanup is out of scope by standing instruction.
