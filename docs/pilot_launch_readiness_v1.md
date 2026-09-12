# Pilot Launch Readiness v1

2026-09-13. Not a feature package. The question is one question: **can this be deployed for a real
seller, and can it be undone if it goes wrong.** Product-owner decisions of the same date fix the
three answers this repository was still carrying as open questions — migration policy, return-visit
measurement, and the QA rows in the Demo Org.

No new product feature. No Opportunity Engine, Customer Timeline, autonomous execution, Managed
Execution, NAVER development or Attention tuning.

---

## 1. Migration safety

### 1.1 What was actually true before this

The previous package's report said CI does not validate migrations. Re-derived at this commit, the
shape is worse than that sentence:

| | before | after |
|---|---|---|
| migrations | 97 | 98 (V100) |
| undo scripts | 0 | 0 — and now refused by a test |
| CI runs against | H2, **Flyway disabled** | H2 **plus** a real PostgreSQL 16 that migrates from empty |
| `baseline-on-migrate` | `true`, everywhere, not overridable | `false` by default, reachable by name, refused by `deploy.sh` |
| pre-migration dump | none in the deploy path | step 3 of 7, and a failed dump stops the deploy |
| destructive-change rule | not written down | expand → migrate → contract, enforced per file |

So until this commit **no automated run had ever applied these migrations to PostgreSQL** — the only
engine any deployment uses. Every one of the 97 was proven by a human starting the local stack, or by
a deploy, on a host that had a seller's data on it.

### 1.2 Forward-only, and no undo written after the fact

Decision: forward-only stays; undo migrations are **not** written retroactively. Rollback is
`pg_dump` + restore.

That is a decision, not a gap, and the honest way to keep it is to make the opposite impossible to
add casually. `MigrationContractTest` (no database; runs in the normal suite) holds three rules:

1. **every file is `V<n>__lower_snake.sql`** — a `U<n>__` undo script would read to a later operator
   as "this is reversible", and Flyway Community cannot run one, so the promise would be unkeepable
   as well as untrue;
2. **V29 and V35 stay burned.** They were taken and released before reaching any database. Flyway
   runs in order (`out-of-order: false`), so a file reappearing *below* the newest applied version is
   not applied — it is reported by `validate` as resolved-but-not-applied. That failure lands on the
   production host, not on the developer's empty one;
3. **a destructive statement names the expand it completes** (below).

### 1.3 expand → migrate → contract

A `drop column`, `drop table` or `rename` breaks the running old code the instant it commits — and
during a deploy the old code *is* running. The decision is: add the new shape, move the data and the
readers, and only then, in a **later** migration after the readers have shipped, remove the old one.

No test can see whether the expand happened three releases ago. What a file *can* carry is the
citation, so that is what is enforced: a destructive statement requires a `-- contract: V<n>` marker
naming an existing, older migration. It turns "we agreed to do expand/migrate/contract" into "a drop
cannot land without someone writing down which expand it completes".

**Measured baseline: 98 migrations, zero destructive statements.** The guard is green on the entire
history, so the first file it ever fails will be a new one. `V81` and `V50` widen a `varchar`, and
`V26`/`V43`/`V99` set `not null` on a column the same migration created — all expands, deliberately
not in the pattern.

### 1.4 `baseline-on-migrate = false`

`true` says: if this database has tables but no Flyway history, assume everything up to now was
applied and start here. On an empty database that is a no-op. On a hand-built or **half-restored**
one it writes a baseline row, skips every earlier migration, and reports success — the schema is
wrong and nothing says so. A partial restore is exactly the database a pilot host can end up with.

- shipped default is now `false` (`application.yml`), overridable by name
  (`SELLEROPS_FLYWAY_BASELINE_ON_MIGRATE`) for the one legitimate case: adopting a database whose
  history genuinely predates Flyway;
- `docker-compose.yml` passes the name through, so it is reachable in a container at all;
- `deploy/pilot/deploy.sh` **refuses** any value but `false`;
- `validate-on-migrate: true` and `out-of-order: false` are written down beside it. Both are Flyway
  defaults; they are the two properties the rest of this section rests on.

### 1.5 CI: empty PostgreSQL → migrate → validate

`.github/workflows/migration-ci.yml`, on every PR and push that touches the migrations, the
application config, the migration tests or the build file:

1. `MigrationContractTest` first, with **no database** — a bad migration *file* fails before a
   container is asked to apply it;
2. the job **asserts the database is empty** (`information_schema.tables` in `public` = 0), so
   "migrated from empty" is observed rather than assumed;
3. `FlywayMigrationIntegrityPostgresProofIT` against `postgres:16-alpine` — the same major the
   deployment runs — asserting four things:
   - every resolved migration is `SUCCESS`: nothing pending, nothing failed, **nothing ignored**
     (an ignored entry is the out-of-order failure of §1.2),
   - `flyway.validate()` passes — every applied migration's checksum still matches its file, which
     is the check that catches an **edited** migration,
   - **no baseline row** — the history starts at the first real migration, so the schema was built
     rather than assumed,
   - the configuration under test is the deployed one: baseline off, validate on, in order. A proof
     run with more forgiving settings than the deploy proves the wrong deploy.

It reuses the repository's existing `SELLEROPS_PG_PROOF=1` opt-in, and selects **only** the migration
proof: the other Postgres proof classes stay a local tool rather than becoming a gate.

Verified locally against a throwaway database on this machine (never the Demo DB): **98 applied from
empty, latest V100, 0 failed, 0 baselined**, 4 tests, 0 skipped.

### 1.6 Rollback runbook

The schema is forward-only, so "roll back the deploy" means **restore the pre-migration dump and
check out the previous commit**. The dump therefore has to exist before the migration runs, and
`deploy.sh` now takes it itself rather than trusting an operator to remember:

```
deploy/pilot/deploy.sh
  1/7 code       git pull --ff-only
  2/7 env        names and shapes only; refuses baseline-on-migrate ≠ false
  3/7 backup     pg_dump -Fc  ← the rollback point, taken BEFORE Flyway runs
  4/7 build
  5/7 up         backend boot runs Flyway
  6/7 health
  7/7 smoke
```

- skipped when postgres is not running yet (a first deploy has nothing to lose) and on an explicit
  `--no-backup` (retrying a failed deploy without a second dump of unchanged data);
- **a dump that fails stops the deploy.** Migrating without the rollback point the operator thinks
  they have is the one failure this step exists to prevent;
- the step prints the restore line, including the commit to check out.

To roll back:

```
deploy/pilot/restore.sh /var/backups/sellerops/sellerops-YYYYmmdd-HHMM.dump   # asks for RESTORE
git -C /opt/sellerops/repo checkout <the commit the backup step printed>
deploy/pilot/deploy.sh --no-pull --no-backup
```

`restore.sh` stops the backend and runtime first (no writers), drops and recreates `public`, and
restores. Two things it is honest about: the vault master key must be the one that sealed the
credentials in the dump — a different key opens nothing, by fingerprint — and the dump deliberately
contains **no env secret**, so the key file is the operator's to keep.

Daily backups are the same script on cron (`17 3 * * *`), 0700, 14 days.


---

## 2. Return-visit instrumentation

### 2.1 The decision, and what it rules out

The previous package left this as the one unanswered business hypothesis: *does the seller reopen
Home*. Four of the five read from tables the product already keeps for its own work; this one had no
source — no login record, no session row, and a frontend analytics module that is a no-op without
vendor env and gated on 분석 consent besides.

Product-owner decision, 2026-09-13:

- **no external analytics.** The vendor module is untouched and stays untouched;
- a **first-party minimal signal**, whose purpose is exactly one question: did they come back;
- **`HOME_OPENED` at org/day granularity only**;
- **no** user id, IP, user agent, clickstream, or review content;
- several visits by one org on one day are **one usage day**;
- the Demo Org is **out of the pilot metrics** — by cohort, as §4 of the usage-loop doc already says.

### 2.2 The table is the privacy statement

`V100__home_open_day.sql` has two columns and **both of them are the primary key**:

```sql
create table home_open_day (
    org_id    uuid not null references organizations (id) on delete cascade,
    opened_on date not null,
    primary key (org_id, opened_on)
);
```

There is nowhere to put a user, a session, an address, a path or a word anybody wrote. That is not a
rule someone has to keep: a column that does not exist cannot be filled in by a later change nobody
read closely. `HomeOpenDayShapeTest` pins the entity's field count, the migration's column count,
and — the check that would actually catch the drift — that the package does not so much as **name**
any of the things it promised not to store.

"One usage day" is the key, not a careful query. Opening 홈 nine times on a Tuesday writes one row
and the ninth open writes nothing, so the table **cannot express** a visit count, a session, or a
dwell time even if someone later wanted it to. That is also why this does not contradict
`pilot_usage_loop_v1.md` §6-E, which excludes "Home 열람 수 그 자체" from the KPIs: the open count is
not stored anywhere.

The date is **Asia/Seoul and the server decides it**. A client-supplied date is a client-supplied
fact, and the day being counted is the seller's.

### 2.3 One writer, and it is a POST

`POST /api/usage/home-opened` — no body, `204`, called once from the Home's mount.

Not a side effect of `GET /api/operations/home`, because a GET that writes is also written through by
a health check, a prefetch, a retry and the smoke script — and the number would then count this
repository's own probes as a seller's morning. One explicit call with one caller is a number somebody
can still explain in a month.

The write is `REQUIRES_NEW` (never joins the caller's transaction) and both the service and the
controller swallow failure. On the page it is `void api.recordHomeOpened().catch(() => {})`: awaited
by nothing, rendered by nothing. A measurement that can break a seller's morning eventually will, and
what it protects — one day in a denominator — is not worth that.

`HomeOpenSignalTest` holds the four ways the number could quietly become a different number: a page
that mounts twice must not double a day; two days are two days; **22:00Z is the 14th in Seoul**, not
the 13th (the one error that changes no total and moves visits across every weekly boundary); and one
seller's mornings are not another's.

### 2.4 The query

In `pilot_usage_loop_v1.md` §6-F, with the cohort applied the way §4 already specifies — an explicit
org list, and the canonical Demo Org is not in it. The product carries no "is this real" flag,
because a flag like that is always missing from exactly one place.


---

## 3. Pilot deployment checklist

The checklist is `deploy/pilot/preflight.sh`, because a checklist an operator reads is a checklist an
operator believes they completed. It is read-only — starts nothing, writes nothing, creates no cloud
resource — and for every secret it prints only whether the **name** has a value.

It runs **before the first deploy**, when its answers are still cheap: a wrong host name costs a
Let's Encrypt rate-limit, and a wrong Cafe24 redirect URI is not discovered until a real seller is
standing in front of a consent screen.

| # | Checks | Why it is here rather than in the deploy |
|---|---|---|
| 1 | env file exists, mode 0600, **outside the checkout** | a pilot secret must never be one `git add` away |
| 2 | host, ACME email, DB password, JWT secret present; JWT not the placeholder and ≥ 32 chars | values a deploy cannot invent |
| 3 | **DNS resolves, and resolves to THIS host**; :80/:443 free | ACME rate-limits failures, and a callback that arrives somewhere else arrives nowhere |
| 4 | Cafe24-only posture, and it **prints the exact redirect URI to register** | byte-identical is the whole requirement; printing it turns a class of failure into a copy-paste |
| 5 | seed / demo content / both mock switches off; mail mode is not the developer outbox | nothing on this host may manufacture rows, or log a password-reset link |
| 6 | `baseline-on-migrate=false`; the backup directory exists; daily cron noted | §1 — the deploy takes the pre-migration dump *there* |
| 7 | docker, compose plugin, RAM | the overlay needs compose ≥ 2.24 for `!reset`; the Gradle build stage peaks above 2 GB |

Two things it deliberately does **not** claim:

- **whether :80/:443 are reachable from the internet.** That is a security-group fact this script
  cannot see from inside the host, and a check that guessed would be worse than the note it prints;
- **that the Cafe24 app is registered.** It prints the string; whether someone pasted it into the
  Cafe24 developer console is outside this repository, and §5 lists it as an external value.

Exit code is non-zero when anything failed, so it can gate a deploy in a script.

---

## 4. Cafe24-only deployment smoke

### 4.1 Why "Cafe24-only" is a posture worth naming

The previous package proved by test that the two remaining blockers were **two requirements pointing
in opposite directions**, not one: the HTTPS host is *inbound* (Cafe24's redirect URI), the fixed
IPv4 is *outbound* (NAVER's registered call IP). A Cafe24-only pilot therefore needs **no fixed
public IPv4**, and an Elastic IP is a prerequisite of *adding NAVER*, not of starting.

That was true in a test. What it was not, until now, was visible on a running host — so
`smoke.sh` says it out loud, and `pilot.env.example` opens with it.

### 4.2 What the smoke adds

Everything that was there stays (HTTPS, redirect, health via edge, demo entry off, anonymous refusal,
raw ports closed, volume, restart policies, validator green, CSP naming the helper and this site's own
runtime origin, egress). New, and each of them is a deploy that would otherwise look fine:

**Cafe24 posture**
- the backend's **actual** `SELLEROPS_CONNECTOR_CAFE24_REDIRECT_URI`, read out of the running
  container, equals `https://<host>/api/connect/cafe24/callback`. The token exchange reads that very
  property, so a mismatch is not a 404 — it is a consent that cannot complete anywhere;
- Cafe24 app credentials present when the connector is on;
- with NAVER off, the smoke states that **no fixed outbound IPv4 is required for this pilot**. An
  operator reading a green smoke should not still be wondering whether they are missing an Elastic IP.

**Schema state, right after the deploy that migrated it**
- applied count equals the number of `V*.sql` files **in this checkout** — a host running an older
  image against a newer checkout is exactly the state nothing else notices;
- zero failed migrations;
- **zero baseline rows** — a baseline row means the migrations before it never ran here, and nothing
  else in the system would ever say so.

**Pilot measurement**
- `POST /api/usage/home-opened` refuses anonymous. It is the one endpoint whose whole purpose is to be
  measured, so an anonymous POST reaching it would be an anonymous row.

The env file is now sourced once at the top, so every check reads the same file the deploy validated.

### 4.3 What the smoke still cannot do

It is credential-free and WRITE-free by design, so the first Cafe24 OAuth consent — the one that
proves a real mall's token endpoint accepts this host's request — remains the **first pilot seller's
first connection**. That has been the standing verdict since Pilot Readiness Gate v1 and this package
does not change it.


---

## 5. Core loop pilot smoke

Run at this commit against the local stack (backend, agent-runtime, frontend), connectors **off**,
no marketplace call, no credential, no model call. Two legs, because one of them turned out to be
impossible on the other's data — and the reason is a finding, not an accident.

### 5.1 Leg A — acquisition → Home → Repeated Issue → decision → Home

On a **disposable organisation** created through the product's own `POST /api/auth/signup`
(`@example.invalid`, random nonce, never a value read from the environment). The canonical Demo Org
was not written to in this leg.

| step | how | observed |
|---|---|---|
| **acquisition** | `POST /api/uploads?uploadType=REVIEW` — the product's own ingest path, 8-row CSV | `PARTIAL`, **7 stored, 1 rejected**: the blank-body 5★ row, because the review mapper requires a body |
| **Home** | `GET /api/operations/home` | 확인 필요 **5** undecided, 관찰 **0** problems, three rows carrying the customer's own sentence |
| **extraction** | `POST /api/review-issues/extract` | scanned 7 → **3 issues**, 6 evidence, 9 unknown units |
| **Home** | again | problems **decidable 0 / observing 3** — OBSERVING is present and is *not* presented as urgent |
| **Repeated Issue** | `GET /api/review-issues/{id}/repeat-context` | 「리뷰 **6건 중 3건**이 이 문제를 말했습니다」 · ★ spread **1★×1, 2★×2** as counts · change `NEW`, surge 3 / baseline 0 |
| **issue decision** | `POST /api/review-issues/{id}/acting` from **OBSERVING** | `ACTING` — the 2026-09-12 decision, exercised live |
| **Home** | again | problems **decidable 1 / observing 2**, ACTING sorted first |

The rendered page was checked in a real browser (1440×900@2×): the denominator pair is a pair and
never a rate, the rating bands render zeros, the evidence quotes carry 「이 리뷰 처리하기」, and the
issue reads 조치 중. **Console errors 0, off-host requests 0.**

**The 1 rejected row is worth keeping.** The blank-body review could not even be *ingested* by CSV,
which is the same shape as the denominator honesty the Repeated Issue screen already states: the
extractor only reads reviews with a body, so a review it never read sits in the denominator and
cannot reach the numerator. Here it does not reach the denominator either — a narrower fact, and one
the pair on screen does not claim otherwise.

### 5.2 Two findings, reported and not fixed

Both are the same shape: **the product treats "a connected channel" as the precondition for having
work**, and a file-upload-only organisation has work without one. Neither affects a Cafe24 pilot,
where OAuth creates the account — which is exactly why they are reported rather than fixed here.

1. **A CSV-ingested review has no seller account, and the Decision Workspace is account-addressed.**
   `/api/seller-accounts/{accountId}/channel-reviews/{reviewId}/decision-context` has no address to
   go to. The product already says so deliberately and does not crash — the page renders
   「이 리뷰의 판매 계정을 확인하지 못했습니다 · 리뷰 처리는 계정 단위로 열립니다」, observed live. The
   `/api/uploads` lane creates reviews owned by a channel but by no account.
2. **Home shows the first-use screen to an organisation that has 7 reviews and 3 repeated problems.**
   `homeFirstUseState` derives `NO_CHANNEL` from connection state, and `AgentHome` gates the four
   operations areas on `!beforeFirstConnection`. So the areas the API had already filled were not
   drawn, and the page said 「판매 채널을 연결하면 시작할 수 있습니다」. Changing that gate is a
   first-use semantics decision, not a bug fix, and this package does not make product decisions.

### 5.3 Leg B — Home → Decision Workspace → decision → Home (real data, browser)

On the canonical Demo Org, where a seller account exists, in a real browser at 1440×900@2×:

```
Home        「아직 판단하지 않은 리뷰가 12건 있습니다」
            → click the first row (/reviews/reply/{reviewId})
Workspace   /reviews/{accountId}/reply/{reviewId}
            customer's sentence · ★1 · 확인 필요 · 「채널에 이미 답변이 등록된 리뷰입니다」
            · 반복 신호 · 이 상품에 대해 우리가 아는 것 (리뷰 1,761건 · 부정 3건 · 지식 3 · 기준 2)
            · 판매자 판단 [확인 필요 / 지켜보기 / 참고]  · 조치 [대응 필요 / 지켜보기 / 조치 불필요]
            → 「대응 필요」
Home        「아직 판단하지 않은 리뷰가 11건 있습니다」
```

**12 → 11.** That is the whole point of the loop: a judgement made in the workspace moves the number
the Home leads with. Console errors 0, off-host 0, marketplace calls 0, model calls 0.

### 5.4 The return-visit signal, live

- three `POST /api/usage/home-opened` in one day → **one row**;
- across both organisations and every browser run of this session → **one row each**;
- anonymous `POST` → **401**;
- the row is dated **2026-09-13** while the server's own clock read `2026-09-12T18:0x` UTC — the
  Asia/Seoul rule, observed rather than asserted;
- the cohort query returns the pilot organisation only; the Demo Org is not in the list.

`tools/dev/org-cleanup.sh` found `home_open_day` by itself (it enumerates tables carrying `org_id`),
and deleting the disposable organisation removed its usage day with everything else: **48 rows in one
transaction**, Demo Org untouched.

### 5.5 What this smoke does not prove

- **a live Cafe24 acquisition.** Connectors are off and a live run needs a fresh single-use approval
  that this milestone did not grant. The acquisition leg above is the product's own ingest path;
- the first Cafe24 OAuth consent against a real mall — still the first pilot seller's first
  connection, as it has been since Pilot Readiness Gate v1;
- anything about latency or cost under load.

---

## 6. Remaining external values

Nothing in this list is code, and none of it can be produced from inside this repository.

| # | Value | Who provides it | What is blocked without it |
|---|---|---|---|
| 1 | Region / account, and an instance | product owner (billable) | everything |
| 2 | **A domain name**, with an A record to that host | product owner | TLS, CORS, the callback — `preflight.sh` refuses to proceed without it |
| 3 | ACME contact email | product owner | certificate issuance notices |
| 4 | **Cafe24 app** (client id + secret) registered with the redirect URI `preflight.sh` prints | product owner, in the Cafe24 developer console | the only connector this pilot turns on |
| 5 | `/etc/sellerops/pilot.env` at mode 0600, outside the checkout, with the secrets generated **on the host** | operator | boot |
| 6 | :80 / :443 reachable from the internet | operator (security group) | ACME HTTP-01, and the callback |

**A fixed public IPv4 is not on this list.** It is NAVER's requirement and NAVER is off.

---

## 7. Verdict

**READY TO DEPLOY PILOT — pending the six external values in §6.**

No code-side blocker remains. The change from the previous package's `READY_PENDING_HOST` is not that
the host appeared; it is that the three things that were still only true in a test are now true on a
running host and enforced on the way there:

- the schema is proven against PostgreSQL in CI, from empty, with `validate`;
- the deploy takes its own rollback point before it migrates, and refuses to continue without one;
- the one hypothesis the product could not answer about itself now has an answer, in a table that
  cannot hold anything else.

### PRODUCT_DECISION_NEEDED

1. **Pilot host provisioning** — the six values in §6. Items 1 and 4 cost money.
2. **First-use semantics for an organisation with data but no connected channel** (§5.2). Today Home
   shows 「판매 채널을 연결하면 시작할 수 있습니다」 to a seller who has reviews and repeated problems,
   because the gate reads connection state rather than whether there is work. It does not affect a
   Cafe24 pilot; it does affect any file-upload-only seller.
3. **Whether a file-upload lane should bind reviews to a seller account** (§5.2). Without one, the
   review Decision Workspace is unreachable for those rows — honestly, but unreachably.
4. **The Demo Org's QA rows stay** (2026-09-13 decision) and are excluded by cohort. This session's
   smoke added one more: a `대응 필요` disposition on review `e9900db2`. Metrics are unaffected — the
   Demo Org is not in the cohort — and nothing was deleted.
