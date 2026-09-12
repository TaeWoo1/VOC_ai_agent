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
