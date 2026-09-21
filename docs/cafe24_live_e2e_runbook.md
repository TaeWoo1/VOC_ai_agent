# Cafe24 Live E2E Runbook (2026-09-21)

**What this is.** The operating knowledge established while driving a real Cafe24 inquiry towards the
Customer Goal loop, written down so the next session does not rediscover it. Every line here was
**observed in that session** — a boot that failed, a row that moved, a constant read out of the source.
Nothing is inferred, and where something is still unproven this document says so rather than rounding it up.

**What this is NOT.** Not capability truth (`docs/multi-channel-connector-roadmap.md` §4.1 owns that), and
not a promotion of anything. It records how to get the runtime into the state where the last E2E hop can be
attempted, and what the attempt cost.

**No secrets here.** Environment variable *names* only. Two values that are not secrets — the registered
redirect URI and the vault **key id** — are written down because the runbook is useless without them.

---

## 1. Preconditions

### 1.1 Flyway — the database must be at V115

The dev database was at **V105** when this work started; the path needs **V107** (`responsibility`,
`responsibility_run`, `responsibility_run_source`, and the `proactive_case` columns `responsibility_id`,
`disposition`, `required_authority`, `summary`, `recommended_action_type`, `missing_information`) and
**V115** (`inquiry_goal_interpretation`). Without V107 the `OperationsCase` entity cannot even load: it is
mapped `@SQLRestriction("responsibility_id is not null")` against a column that does not exist.

Applied by booting the app with everything else off — Flyway owns the schema and no other route records the
history correctly:

```
./gradlew bootRun --args='--server.port=0 \
  --sellerops.collect.scheduler-enabled=false \
  --sellerops.responsibility.scheduler-enabled=false \
  --sellerops.proactive.enabled=false \
  --sellerops.self-pilot.enabled=false \
  --sellerops.seed.enabled=false'
```

Observed: 10 migrations (V106→V115) in 338 ms, **0 ERROR/WARN**, and **0 rows created** —
`responsibility` 0, `inquiry_goal_interpretation` 0, `proactive_case` unchanged at 2, inquiries/reviews/orders
unchanged. The only channel word in the whole boot log was a migration *filename*.

### 1.2 Spring does not read `.env.local`

Values must be placed in the **process environment** of the boot. This is why a capability can be "configured"
in that file and still be off in a `bootRun` — and it is also the fence that keeps unrelated capabilities off:
pass only what the run needs and every other LLM capability stays disabled, because its key is absent.

### 1.3 Vault

| variable | property | note |
|---|---|---|
| `SELLEROPS_VAULT_MASTER_KEY` | `sellerops.vault.master-key-base64` | base64 of 32 bytes; empty ⇒ vault fails closed |
| `SELLEROPS_VAULT_KEY_ID` | `sellerops.vault.key-id` | default `local-dev-1` |
| `SELLEROPS_VAULT_KEY_RING` | `sellerops.vault.key-ring` | retired keys `id:base64,…`; **absent** in this environment |

Sole reader: `credential/VaultKeyRing.java:43`.

**The demo org's Cafe24 credential is sealed with key id `self-pilot-1`.** A row is opened with the key that
sealed *it*, so the active key id must be `self-pilot-1` — with no key ring configured, any other active id
is a `KEY_MISMATCH` and the credential cannot be opened. Set `SELLEROPS_VAULT_KEY_ID=self-pilot-1`.

### 1.4 Cafe24 connector — five values, and it fails closed twice

```
SELLEROPS_CONNECTOR_CAFE24_ENABLED=true
SELLEROPS_CONNECTOR_CAFE24_API_VERSION      (value in backend/.env.local)
SELLEROPS_CONNECTOR_CAFE24_CLIENT_ID        (value in backend/.env.local)
SELLEROPS_CONNECTOR_CAFE24_CLIENT_SECRET    (value in backend/.env.local)
SELLEROPS_CONNECTOR_CAFE24_REDIRECT_URI=https://jake-unapperceptive-karlene.ngrok-free.dev/api/connect/cafe24/callback
```

Both failures below were hit in this session, in this order. **Neither is a defect** — they are the
fail-closed rule working, and knowing them saves two boots:

1. **Missing `API_VERSION`** — bean creation fails:
   `Cafe24HttpClient: 카페24 API 버전(sellerops.connector.cafe24.api-version)이 설정되지 않았습니다.`
   Note the chain: `Cafe24HttpClient` ← `Cafe24TokenClient` ← `Cafe24Authorizer` ← `Cafe24ExactOrderReader`
   ← `ExactOrderReaders` ← `InquiryOrderFactReader` ← `InquiryEvidenceRetriever`. With the connector on,
   the Cafe24 HTTP client is **not** optional.
2. **Loopback `REDIRECT_URI`** — the context starts and then a startup listener aborts it at
   `PilotConfigValidator:91`: *「카페24 OAuth callback 주소가 아직 기본값(로컬 주소)입니다」*. The rule is an
   absolute HTTPS URL that is not the loopback default.

`SELLEROPS_CONNECTOR_CAFE24_REDIRECT_URI` and `SELLEROPS_CONNECTOR_CAFE24_SCOPES` are **not present** in
`backend/.env.local`; the scopes fall back to the read-only default
`mall.read_community,mall.read_order,mall.read_product`, which is what a READ-only run wants.

### 1.5 OAuth refresh and rotation — read this before running anything twice

`Cafe24TokenClient:77-78` sends **only** `grant_type=refresh_token&refresh_token=…`. The **refresh path never
sends `redirect_uri`** — that property is read by the authorization-code exchange alone. So for a
collection-only run the redirect URI is inert config; it still has to satisfy §1.4's validator.

**The refresh token is single-use** (`Cafe24TokenClient:26`) and rotates on every run. Observed twice in this
session: the credential row's `updated_at` moved to 21:44:14 (Run 1) and 21:55:08 (Run 2a). Consequences:

- every Cafe24 run spends the stored token and writes back a new one;
- speculative re-runs are not free — each one burns a rotation;
- an interrupted run is how a token gets stranded.

The token here had last succeeded **16 days earlier** and still refreshed, so the practical lifetime is longer
than a fortnight — but do not rely on that.

---

## 2. What `CUSTOMER_OPERATIONS_V1` actually covers

`ResponsibilityTemplate.CUSTOMER_OPERATIONS_V1` declares exactly two sources:

```
CAFE24 · INQUIRY
CAFE24 · REVIEW
```

**No NAVER, no Coupang.** A NAVER inquiry is outside this responsibility entirely — which is why the earlier
goal smoke (a NAVER inquiry) proves nothing about discovery.

The template also lists four device recipes (`CUSTOMER_OPERATIONS_FIXTURE_OBSERVE_V1`,
`COUPANG_REVIEW_OBSERVE_V1`, `NAVER_REVIEW_OBSERVE_V1`, `NAVER_PRODUCT_INQUIRY_OBSERVE_V1`), but
`sellerops.responsibility.aside.enabled` defaults **false**, so they do not fire: no local helper, no browser,
and none of the in-run `aside.wait-seconds` (default 120) is spent.

### 2.1 The inquiry collector reads board 6 only

`Cafe24BoardArticleMapper`:

```
REVIEW_BOARD_NO         = 4
PRODUCT_INQUIRY_BOARD_NO = 6
```

`Cafe24ApiConnector.primaryBoard(dataType)` uses these **unconditionally**. So the inquiry collector reads
**board 6 — 상품 Q&A / 상품문의 — and nothing else.** A question posted to a 1:1 문의 board, a general 게시판, or
any other board number is invisible to this path no matter how many times collection runs.

This was observed, not deduced: a manual `INQUIRY` sync logged
`카페24 게시판 수집: board=6 창=[2026-09-07 ~ 2026-09-21] offset=0 수신=0` and stored nothing.

---

## 3. Why a responsibility baseline must never be fabricated

`OperationsCaseProcessor.discover` opens a case for a subject only when:

```
baseline = cases.firstSettledObservation(org, responsibility, account, dataType)   // null ⇒ discover nothing
reach    = now − ACQUISITION_REACH                                                  // 15 days (line 75)
since    = max(baseline, reach)
candidates: created_at > since
```

So discovery needs a **settled source observation**, and `ResponsibilityRunSource` rows are the record of one.
Writing a row that says `INQUIRY observed COMPLETE at T` when no collection happened at T would be
manufacturing a collection that never occurred — and every case opened behind it would be a receipt for it.

**There is no need to.** `ResponsibilitySourceObserver` drives the real `SyncRunExecutor`: a responsibility run
*performs* the collection and records what it actually saw. The honest baseline is simply the first run.

Two consequences that follow from the same arithmetic:

- The **first** run's baseline is `now`, so nothing historical is "new since" it — the first run opens **0**
  customer-work cases by construction. That is correct, not a failure.
- An inquiry older than **15 days** can never be discovered, whatever the baseline says. On 2026-09-21 the demo
  org's freshest unanswered inquiry was 16 days old and **0** REAL inquiries fell inside the window — which is
  precisely why a *fresh* question had to be posted rather than an existing one reused.

---

## 4. The procedure

### Run 1 — baseline (`resp-run1-baseline/1`)

Boot with §1.3 + §1.4 plus:

```
RESPONSIBILITY_RUNTIME_ORG_IDS=<demo org uuid>      # blank = nobody; no wildcard
SELLEROPS_RESPONSIBILITY_SCHEDULER_ENABLED=true
```

Then, through the product's own API (no direct service call):

```
POST /api/auth/login                                        # demo owner; the fixture credential is
                                                            # configured in config/MockDataSeeder.java:115
POST /api/responsibilities/customer-operations/activate
```

**Activation triggers a run immediately** — `RunTrigger.ACTIVATION`. The response carried
`nextRunAt = 13:00Z` (the next 2-hour Asia/Seoul boundary, cadence 120 min), but the run started 16 minutes
earlier, at activation. Do not wait for the boundary.

Observed result: `SUCCESS`, 1.28 s, both sources `COMPLETE` with no `failure_reason`
(`CAFE24 INQUIRY` observed 0/new 0, `CAFE24 REVIEW` observed 1/new 0), **0 cases opened**, account still
`CONNECTED`, refresh rotated.

### Step 2 — the seller posts one question, by hand

This is the only way to get a fresh inquiry without a product marketplace WRITE. It must be a
**상품 Q&A on a product page (board 6)** — see §2.1. Posting it anywhere else produces a successful,
empty collection.

### Run 2a — collection only, no model

Boot **without** `SELLEROPS_RESPONSIBILITY_SCHEDULER_ENABLED` and without `RESPONSIBILITY_RUNTIME_ORG_IDS`,
so no responsibility run can fire, then:

```
POST /api/seller-accounts/{sellerAccountId}/sync     body: {"dataType":"INQUIRY"}
```

Returns a `SyncRunView` (`trigger=MANUAL`, `jobType=CAFE24_API`). **0 model calls, no case opened.** Splitting
this out is deliberate: `OperationsCaseProcessor.process()` collects *and* discovers *and* interprets in one
pass, so the "is there exactly one new inquiry?" check is impossible inside it — by the time you could count,
the model call is already spent.

Then count new ROOT inquiries since the baseline instant and confirm the title before going further.

### Run 2b — discovery, interpretation, case *(not yet performed)*

Boot as Run 1, plus the goal capability for the demo org only:

```
SELLEROPS_INQUIRY_GOAL_ENABLED=true
SELLEROPS_INQUIRY_GOAL_ORG_IDS=<demo org uuid>
SELLEROPS_INQUIRY_GOAL_API_KEY=…
```

Expected: collection → discovery → interpretation (**1** model call) → resolution → persisted
`OperationsCase` → Home `DecisionRow`; then a second pass proving vendor calls **+0**, because a reading is
stored per `(org, inquiry, exact message, prompt_version)`.

---

## 5. `STORED_ONLY` — the ceiling, observed

`CaseResolutionReader` asks for `OrderFactLookup.STORED_ONLY`, which is correct for a background run: resolving
a goal is not a reason to call a marketplace.

`CapabilityRegistry.derive` makes `ORDER_FULFILLMENT` available only when an **exact** order read is permitted
*and* the channel has a vendored contract. `EntityStateRequirement.of(ENTITY_ORDER)`'s required dimension is
`ORDER_FULFILLMENT`. Therefore, under `STORED_ONLY`, a `STATE_READ` about an order always terminates
`CAPABILITY_GAP / NOT_SUPPORTED`.

Seen live on a real NAVER inquiry ("언제 발송하나요?"): the binding worked and the resolver observed
`ORDER_PAYMENT=PAID` from the store, and still refused to say whether the order had shipped. The case sentence
is *「이 채널에서는 확인할 수 없는 정보라 답변 근거로 쓰지 못했습니다.」* — the system knowing the order is paid and
declining to claim it knows more.

`ENTITY_LISTING` is *not* subject to this: a stored listing row within its freshness window resolves.

---

## 6. State of the proof

### LIVE_PROVEN

| what | when | evidence |
|---|---|---|
| Goal interpreter as a production capability on one stored inquiry: 1 vendor call, reading stored, resolution, case mapping, second pass at **0** additional calls | 2026-09-21 21:04 KST | `inquiry-goal-demo-smoke/1` — `INTERPRETED`, contract `customer-goal-interpreter/v3`, 4,012 ms, in 1,200 / out 124 tokens |
| Responsibility activation and a genuine baseline: real Cafe24 collection, both sources `COMPLETE`, 0 cases | 2026-09-21 21:44 KST | `resp-run1-baseline/1` — `SUCCESS`, `RunTrigger.ACTIVATION` |
| Manual Cafe24 `INQUIRY` collection with no responsibility run and no model | 2026-09-21 21:55 KST | `resp-run2a-collect/1` — `SUCCESS`, 0 rows, board 6 window 09-07→09-21 |

### Not proven

- **collection → discovery → interpretation → persisted `OperationsCase` → Home `DecisionRow`.** The last hop.
  Blocked only on a fresh board-6 question existing; everything below it is built, tested and guarded.
- Whether the manually posted question of 2026-09-21 exists on board 6. The collector returned zero for that
  window, which is consistent with it having been posted to a different board — **not established either way.**

### Costs observed per run

- Cafe24 refresh-token rotations: **2** (Run 1, Run 2a).
- Marketplace: Cafe24 READ only throughout. **WRITE 0.**
- Model calls: **1** total, and that one was the goal smoke, not a responsibility run.
- `AgentUsageKind.INTERPRET` is charged per interpretation against the org's daily budget
  (defaults: 200 runs / 1000 LLM calls per org per day).

---

## 7. Related

- `docs/inquiry_architecture_v35.md` — the Customer Goal contract and the resolution loop.
- `docs/sellerops_live_approval_contract.md` — the approval lifecycle every run above followed.
- `docs/evidence/INDEX.md` — one row per live run.
- `docs/inquiry_thread_semantics_v1.md` — why a Cafe24 reply is not a new inquiry (`thread_role`).
- `docs/cafe24_comment_answer_observation_v1.md` — board-6 answer shapes.
