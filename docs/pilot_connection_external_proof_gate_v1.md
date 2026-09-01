# Pilot Connection & External Proof Gate v1

*2026-09-01 · HEAD at start `c7510753` · Agent / UI architecture frozen · backend + config + tests only*

Two questions, and an audit.

1. **Does the product's own channel-connection flow actually produce the state
   `CONNECTED_SELLERS` admission reads?** Pilot Readiness Closure v1 shipped the policy and proved
   the read. It could not prove the write — no safe test mall existed, the fixture row was inserted
   straight into the database, and the report said so. That gap is not a detail: "a seller connects
   and the Agent starts working" is false if the connection flow lands in a state the admission
   query does not recognise, and **a hand-inserted row cannot detect that, because it was written to
   match**.

2. **Can synthesized rows reach a seller's tables?** Pilot Readiness Closure v1 §8 found that they
   could and fenced it with a flag that defaulted to *on*. That was the wrong way round.

Then: **is each remaining external live proof runnable, and what does it need?** No marketplace
WRITE was performed in this package.

**Marketplace calls 0 · marketplace WRITE 0 · model calls 0 · migrations 0 · frontend source
unchanged · agent-runtime source unchanged.** No evidence row: nothing external was touched.

---

## 1. What was audited first

| claim carried into this package | verdict |
|---|---|
| the connection flow produces an admitting row | **unproven** — proven only for a row written by hand |
| `MockApiConnector` cannot reach a seller's tables | **false by default** — the fence existed and shipped OFF |
| a channel whose connector is disabled collects nothing | **false** — it collected invented rows, successfully |
| the guided/execution lanes are code-complete | **true** — every one of the five is implemented; none has an external proof |

The second and third are the same defect seen from two ends, and it has no error in it. Nothing
throws, nothing logs, no health check goes red: the sync **succeeds**, the seller's inquiry count
goes up, and the rows carry `data_origin = REAL` because that is the column's default and nothing on
the ingest path knows the difference. By the time anyone asks whether a row is real, the database can
no longer answer.

---

## 2. Admission, proven through the product's own flow

Nothing was inserted. Both proofs drive the real `Cafe24OnboardingService` — the real
`/api/connect/cafe24/start`, the real state guard, the real mall-identity gate, the real token
request this repository builds, the real `CredentialVault` sealing, the real status transition, the
real `hasConnectedApiAccount` query and the real `AgentCapabilityAccess` policy.

**Exactly one thing is faked, and it is the one thing that must be:** `Cafe24HttpClient`, whose own
docblock (written long before this package) calls it *"the single, fakeable HTTP boundary of the
Cafe24 connector — every outbound call the connector ever makes goes through this interface"*. The
app credentials in the test properties are placeholders and never leave the process; the stub asserts
the Basic header exists and answers locally.

### 2-A. `ConnectionAdmissionTest` — ordinary CI, no Postgres, 4 tests

| | |
|---|---|
| a seller who finishes the OAuth flow is admitted, with no operator action | refused → `start` → `complete` → `CONNECTED` → `ALLOWED`, one token exchange, one sealed credential |
| a failed exchange admits nobody | `RECONNECT_REQUIRED`, zero credentials written, still refused |
| one org finishing a connection admits only that org | the other org still gets `NEEDS_CHANNEL_CONNECTION` |
| a file-upload account is `CONNECTED` and still not admitted | the one way the two states could quietly converge |

### 2-B. `Cafe24ConnectionAdmissionPostgresProofIT` — the deployed shape, opt-in

`@EnabledIfEnvironmentVariable(SELLEROPS_PG_PROOF=1)`, the pattern the repository already uses for
disposable-Postgres proofs. It boots the **real Spring context the way a pilot host boots it** —
`SELLEROPS_AGENT_ACCESS_SCOPE=CONNECTED_SELLERS`, the plan allow-list **naming nobody**, the demo
seeder off, both mock switches off, `PilotConfigValidator` passing at `ApplicationReady` — over real
Flyway on real PostgreSQL, and walks the real HTTP endpoints with real JWT authentication.

**Executed 2026-09-01, disposable database `pilot_connection_proof`, 2/2 passed:**

| observation | value |
|---|---|
| migrations applied by real Flyway | **86** |
| signup → `POST /api/agent/plan` | `available=false`, `unavailableMessage` = 「판매 채널을 연결하시면…」 |
| `POST /api/connect/cafe24/start` | 200, account `PENDING`, consent URL on `pilotproofmall.cafe24api.com` |
| after start, admission | still refused — *starting is not finishing* |
| `GET /api/connect/cafe24/callback` | **302**, `status=connected`, and the authorization code is **not** in the redirect |
| token exchanges | **1** |
| account row | `CONNECTED`, `is_file_upload = false` |
| sealed credentials | **1** |
| admission after the callback | `ALLOWED`, seller message `null` — **same process, no env edit, no restart** |
| a second seller on the same host | still refused |
| synthesized rows in the disposable DB | **reviews 0 · inquiries 0** |
| the real local `sellerops` database | **untouched** — 44 organisations before and after |

**What stays external and is not claimed here:** a real mall's consent screen, the authorization code
it issues, and whether that mall's token endpoint accepts the request this client builds. Their live
proof is a first pilot seller's first connection, and §5 keeps that open.

**One deliberate omission, stated.** The ending is asserted on the real policy bean rather than by
calling `POST /api/agent/plan` a second time. Past the gate that endpoint issues a paid request to
the model vendor, and a test must not buy one to learn something the gate already answered — the
refusal, which costs nothing, **is** asserted over HTTP.

---

## 3. Fail closed: the offline fixture cannot reach a seller

Two fences, deliberately independent, because they fail in different ways.

| fence | property | default | what it makes impossible |
|---|---|---|---|
| the bean's existence | `sellerops.connector.mock.enabled` | **false** | nothing can resolve `MockApiConnector` — not the registry, not a code path written later by someone who never read it |
| resolution | `sellerops.connector.mock-fallback.enabled` | **false** (was `true`) | a channel with no dedicated connector resolves to **nothing**, rather than to whatever happens to declare no channel |

Neither depends on the other being right. Shipping the second one default-on was the error worth
naming: it made every deployment that *says nothing* — which is every deployment nobody has yet
audited — the unsafe one.

**A third condition, at boot.** `PilotConfigValidator` now refuses a deployment where the offline
fixture and a real marketplace connector are on together. Both switches are doing exactly what they
were set to do, which is why nothing else in the system would ever complain: the synthesized rows and
the collected rows land in the same tables as `data_origin=REAL` and become inseparable. Boot is the
last moment they are still distinguishable.

**The fixture is not deleted.** `ConnectorRegistry`'s single-argument constructor keeps the fallback
on, and that *is* the meaning of "an explicit dev/test fixture": a caller that passes
`List.of(new MockApiConnector())` has said, in the only way that matters, that it wants the offline
stand-in. Spring never reaches that constructor.

### The three states the brief names — `MockConnectorFenceTest`

Each asserts the one thing that stays true whatever else is wrong: **no rows**. The registry is built
the way Spring builds it (`mockFallbackEnabled = false`) and the mock is deliberately **in** the
connector list anyway — passing because the fixture was left out would prove nothing about a
deployment where it is present.

| state | result |
|---|---|
| the channel's connector is off (INQUIRY, and REVIEW — the type the mock is most willing to invent) | run `FAILED` (configuration, not connectivity); inquiries 0 · reviews 0 · order summaries 0 · work items 0 |
| the connector exists, the credential does not | `FAILED`; job type is **not** `MOCK_API`; no rows |
| the connector exists and does not serve this data type | `FAILED`; job type is **not** `MOCK_API`; no rows |
| an explicit fixture asks for the mock | still `SUCCESS` with rows — this is a fence, not a deletion |

`MockConnectorAvailabilityTest` fixes the defaults themselves, including by reading
`application.yml` as text: a default lives in the string inside `@Value` and in the YAML, and "OFF
unless asked" is the whole claim.

### Observed on the running local stack

After restarting the backend on these defaults (clean boot, **0 ERROR / 0 WARN**, 7.6s):

| channel | before (mock as universal fallback) | now |
|---|---|---|
| CAFE24 / NAVER / COUPANG (own connector on) | their own connector | **unchanged** — their own connector, same data types |
| GMARKET / ELEVENST / SSG (no connector) | `connectorClass=API`, auto-collect **true**, every data type "supported" | `connectorClass=null`, auto-collect **false**, 0 data types |

The second row is the fence being honest: a channel we cannot collect from now says so, instead of
advertising a capability that was the mock's.

---

## 4. External live-proof readiness

**No marketplace WRITE was performed.** This section records what each proof needs and where its
safety boundary is. "READY" means *nothing in this repository blocks it*; every one of them still
needs an external account and a real object to act on.

| # | proof | code status | verdict |
|---|---|---|---|
| 1 | NAVER Guided Acquisition (`import/naver`) | implemented · locally proven | **READY** |
| 2 | NAVER Review Guided Reply composer-fill (submit forbidden) | implemented · real-DOM proven | **READY** |
| 3 | Cafe24 review comment | implemented · locally proven | **BLOCKED — no safe test review** |
| 4 | NAVER customer inquiry reply (네이버페이) | implemented · never exercised | **BLOCKED — no unanswered test inquiry** |
| 5 | Coupang inquiry reply / guided acquisition | implemented · never exercised / locally proven | **BLOCKED — credential + call-IP + test object** |

### 1 — NAVER Guided Acquisition · READY

The seller exports from NAVER's own screen; the helper detects and validates the result.

- **Needs:** a NAVER Commerce seller account; the local helper **paired from a foreground TTY** (a
  detached resident helper refuses pairing with `503 approval_unavailable` — `bridge-server.ts`); the
  seller's own click on NAVER's export control.
- **Boundary:** READ only. No automatic export, download or submit — the human checkpoint is the
  seller's click, and SellerOps only detects, validates and processes what it produced.
- **Nothing in the repository blocks this.** It is the cheapest of the five and the only one whose
  worst case is "the walk did not recognise the page".

### 2 — NAVER Review Guided Reply composer-fill · READY, and the only one that types

- **Needs:** the same helper pairing; a NAVER review that is **unanswered**; an **approved** draft
  (Human Approval, unchanged); a `submissionRef` minted by the backend and **spent once** at
  `POST /api/agent/reply-submission-targets`; and the backend must hold a **review-id fingerprint**
  for that review — a `UNAVAILABLE` verdict makes the gate refuse to type at all.
- **Boundary, and it is enforced by an enumerating source guard, not by care:**
  - `.fill(` exists in **one** file (`reply-composer-fill.ts`), and only against the
    driver-tagged `[data-aw-reply-target]`;
  - `.click(` exists in **one** file (`reply-composer-open.ts`), exactly **once**, and only against
    `[data-aw-reply-open-target]`, which the in-page tagger refuses to set on a control whose wording
    is 등록 / 등록 / submit / post / send;
  - `.press(`, `keyboard`, `dispatchEvent`, `.submit(`, `requestSubmit` appear **nowhere** in the
    reply runtime;
  - a module added to that directory and not listed in the guard **fails the build**;
  - the fill gate is pure and fails closed: row match exactly once, review-id match exactly once,
    exactly one composer open, an approved draft present. Any other count types nothing and the run
    continues to the barrier, where the seller pastes — *"could not fill" is never "could not
    reply"*.
  - `COMPOSER_FILLED ≠ posted`. The 등록 press is the seller's, and the seller may edit the text
    first, which is why the state promotes nothing.

### 3 — Cafe24 review comment · BLOCKED

`POST /api/v2/admin/boards/{board_no}/articles/{article_no}/comments` — a real marketplace WRITE.

- **Needs:** `SELLEROPS_REVIEW_PUBLISH_EXECUTION_ENABLED=true` (off by default; with it off **no
  adapter bean exists** and `/reply/execute` records a refusal without touching a transport) ·
  `SELLEROPS_REVIEW_PUBLISH_CAFE24_LIVE_APPROVAL_ID` (blank ⇒ the client throws before the request is
  built) · `SELLEROPS_REVIEW_PUBLISH_CAFE24_SHOP_NO` (**0 = no send**; the contract's default of 1 is
  the platform's, not ours) · the seller's own `mall.write_community` re-consent · **a test review on
  a board the operator owns**.
- **Boundary:** a fresh, single-use, in-turn mode-`WRITE` approval per
  `docs/sellerops_live_approval_contract.md`; the per-review duplicate fence (`ALREADY_EXECUTED`) —
  a comment already under a customer's review means a second POST is a **second public reply**, not a
  retry; the comment password is per-comment ephemeral and stored nowhere.
- **Why blocked:** the missing input is not configuration. It is a **review object on a mall we may
  publicly comment under**, and the only Cafe24 mall available is the one the canonical Demo Org is
  connected to, holding real customer reviews.

### 4 — NAVER customer inquiry reply · BLOCKED

`POST /v1/pay-merchant/inquiries/{inquiryNo}/answer` — implemented, never exercised.

- **Needs:** `…PUBLISH_EXECUTION_ENABLED` · `…NAVER_LIVE_APPROVAL_ID` (mode `WRITE`, max 1) · **an
  unanswered 고객문의 on a store the operator owns**.
- **Boundary:** the approval binds the **subtype**. NAVER's two inquiry subtypes are both bare int64s
  in non-overlapping spaces, so an approval spent on the wrong one would not fail — it would answer a
  different customer's question. The endpoint refuses an already-answered inquiry
  (`ERR-NC-101010`), which is the safer of the two contracts, but *safer is not proven*.
- **Why blocked:** a real customer has to have asked something, and we do not manufacture that.

### 5 — Coupang inquiry reply / guided acquisition · BLOCKED

- **Inquiry reply** (`POST …/onlineInquiries/{id}/replies`) needs `…PUBLISH_EXECUTION_ENABLED`, the
  Coupang connector flag, Wing API key/secret, **the deployment's outbound IP registered with
  Coupang**, and an unanswered inquiry.
- **Guided acquisition** (`acquire/coupang`) needs the paired helper and a Wing login; it is READ and
  its boundary is the same as §1.
- **Why blocked:** the acquisition half is blocked only on a Wing login, but the reply half is blocked
  on credential + call-IP registration + a real unanswered inquiry, and running the acquisition alone
  proves the smaller half of the row.
- **Coupang review reply does not exist and none is planned** — Coupang has no seller review-reply
  feature. That is `NOT_SUPPORTED`, not "not yet".

### The one proof that cannot be manufactured

A **first real channel connection on a deployed host**. §2 proves every line of our side of it. What
remains is a real mall's consent and token issuance against a fixed public HTTPS callback, and the
host for that does not exist yet (§5).

---

## 5. What is still needed, and from whom

**Provisioning inputs (product-owner / operator; none of these are repository facts):**

1. a host with a **fixed public IPv4 and a stable DNS name** (`PILOT_PUBLIC_HOST`, `PILOT_ACME_EMAIL`);
2. a **Cafe24 app** whose registered redirect URI is byte-identical to
   `https://<host>/api/connect/cafe24/callback`, plus its client id and secret;
3. the **NAVER advertised egress IP**, verified with `deploy/pilot/egress-check.sh` before the flag
   is flipped;
4. the model vendor key, and the **access scope** — `CONNECTED_SELLERS` is what the pilot example
   sets and what §2 proves; `ALL_ORGS` admits a drive-by signup;
5. whether **signup stays open** on the pilot host;
6. the **vendor model decision** — every AI capability still defaults to a snapshot the vendor marks
   deprecated (`docs/image_product_knowledge_v1.md` §10; `docs/planner_model_benchmark_v1.md`
   recommends no change on the evidence available).

**Test objects, for the three blocked proofs:** a Cafe24 board article the operator may publicly
comment under; an unanswered NAVER 고객문의; an unanswered Coupang inquiry plus Wing credentials and
a registered call IP.

---

## 6. Verification

| suite | result |
|---|---|
| backend | **3,631** tests · 25 skipped · **0 failures** |
| agent-runtime | **801** passed · 23 skipped |
| frontend | **2,627** passed — source unchanged this package; re-run to confirm |
| disposable-Postgres proof (`SELLEROPS_PG_PROOF=1`) | **2/2**, 86 migrations, details in §2-B |
| local stack restart on the new defaults | clean boot, 0 ERROR / 0 WARN, 7.6s |

**Test contracts rewritten, honestly:** the six `*ConnectorConfigurationTest` classes assert
*dedication* — that a connector serves its own channel and no other — and expressed "no other" as
"still the mock". That sentence is no longer true by default, so their `registryGraph()` now asks for
the fixture the way a dev deployment does. Every assertion is preserved; the defaults themselves
moved to `MockConnectorAvailabilityTest`, and the collection consequence to `MockConnectorFenceTest`.
`ConnectorRegistryTest.springInjectsAllConnectorsAndOnlyMockIsTreatedAsPull` moved the same way.
**No safety test was weakened**, and `AgentDraftBoundaryTest`'s shape rule (one file must not read two
capabilities' property keys) still holds — `PilotConfigValidator` reads a connector property, not a
capability's.

## 7. Reported, not fixed

- **The local stack's behaviour changed for un-connectored channels.** GMARKET / ELEVENST / SSG now
  report auto-collect unsupported instead of the mock's fabricated capability. That is the fence
  working, but it is a visible change to local development, and a developer who wants the old
  behaviour sets `SELLEROPS_CONNECTOR_MOCK_ENABLED=true` **and**
  `SELLEROPS_CONNECTOR_MOCK_FALLBACK_ENABLED=true` (both, on purpose).
- **Synthetic rows the fallback already wrote are still there** — in the local QA org from Pilot
  Readiness Closure v1 (74 reviews / 60 inquiries at `data_origin='REAL'`). Historical cleanup is out
  of scope and would be a judgement about which rows are real.
- **`data_origin` is still `REAL` by default** on `Inquiry` and `Review`. Making ingest stamp
  provenance from the producing connector would be a fourth copy of a rule that now has three
  enforcement points; it is worth considering when a second synthetic producer exists, and not before.
- **The admission policy still runs one existence query per gate check**, uncached (carried from
  Pilot Readiness Closure v1 §9).
- **`sellerops.seed.enabled=true` still creates the demo account** on an empty database. Unchanged;
  what a production boot creates remains a product-owner decision.
