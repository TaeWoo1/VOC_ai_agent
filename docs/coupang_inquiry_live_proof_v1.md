# Coupang 고객문의 — Live Proof v1

> What a real Coupang account actually did on **2026-08-14**, and what it did not. Sanitized: no
> secret, key, vendor id, IP, buyer identity, or inquiry text appears here. Contract + design:
> `docs/coupang_routine_operations_v1.md`.

---

## 0. Verdict

| | |
|---|---|
| **Coupang INQUIRY acquisition** | **LIVE_PROVEN** |
| **Dedupe / idempotency** | **LIVE_PROVEN** |
| Capability badge | `NEEDS_VERIFICATION` → **`CONFIRMED`** |
| Routine work queue / proposal / draft / Action Window | **IMPLEMENTED · LIVE_UNPROVEN** — no unanswered inquiry existed to run it on |
| Coupang REVIEW | unchanged — **BLOCKED**, no official API, nothing built |

One defect was found by the live run and fixed offline (§4). No reply was posted to any buyer.

---

## 1. Environment

Two operator-present sittings, each under its own single-use Approval Manifest, on a disposable
backend (`:18091`) and a throwaway Postgres (`coupang_proof@:55432`) built fresh for this proof.
Scheduler off. Vault master key from the Keychain.

| Sitting | Manifest | Approval | Commit |
|---|---|---|---|
| 1 — credential handoff | `CREDENTIAL_READ` | `apr-b8f9e191…` / run `wt-e619cc437905` | `b67fb372` |
| 2 — inquiry acquisition | `WRITE` (collection state) | `apr-98b667eb…` / run `cp-a7a1ef4a1463` | `152f53b2` |
| 3 — dedupe re-sweep | `WRITE` (collection state) | `apr-e0a7ec8f…` / run `cp-8fc41a61af0d` | `699871ba` |

Sitting 1 was a prerequisite, not part of this proof: the previous unit's database was destroyed at
teardown, so the credential had to be re-established. It re-proved the merged handoff path on a fresh
DB — `STORED_AND_VERIFIED`, three fields, connection `SUCCESS`, zero value exposure.

---

## 2. What the acquisition proved

```
02:37:04  MANUAL  INQUIRY  SUCCESS  ingested 2 · skipped 0 · failed 0   (1.6s)
02:59:53  MANUAL  INQUIRY  SUCCESS  ingested 0 · skipped 0 · failed 0   (0.3s)
```

The first run walked the whole 30-day backfill — five 7-day windows × two answered buckets = ten
signed GETs — and the cursor came to rest exactly on the floor:

```json
{"backfillComplete":true,"earliestSwept":"2026-07-15","throughDate":"2026-08-14"}
```

`2026-07-15` is `today − 30` to the day, which is the offline tiling property (`no gap, no overlap,
terminates at the floor`) holding on real data.

**Three open questions closed, each of which could have been the opposite:**

| Question | Answer | Evidence |
|---|---|---|
| Is the path `api/v5` or `api/v4`? | **v5** | no 404 |
| Does this key's app have 고객문의 permission? | **yes** | no 403 |
| Is the calling IP registered? | **yes** | no `Not allowed IP` |

**Stored shape, value-free:** two rows, both `ANSWERED` with `informStatus=ANSWERED`, `external_id`
`onlineInquiry:158421449` / `onlineInquiry:158846709`, received `07-30 12:00` / `08-07 12:25` KST,
body lengths 83 / 31, bound to the seller account. `author`, `title`, `is_secret` all `null`.
Products created keyed by the channel's own `sellerProductId` (`15411270785`, `15223228019`) with
the key as the name — no product name was invented. **Zero rows dropped as unrepresentable**, so
`inquiryAt`'s real rendering parsed under the KST reading.

The second run collected nothing because the routine window (`08-12`…`08-14`) genuinely contains no
inquiries — not because anything failed.

---

## 3. What the dedupe re-sweep proved

The one hand-write, named in the manifest before it happened: `DELETE 1` on this account's INQUIRY
sync cursor, so the same 30 days would be swept again. Nothing else was modified.

```
03:15:57  MANUAL  PARTIAL(rate-limited)  ingested 0 · skipped 1 · failed 0
03:18:42  RETRY   PARTIAL(rate-limited)  ingested 0 · skipped 1 · failed 0   (attempt 2)
03:27:49  MANUAL  SUCCESS                ingested 0 · skipped 0 · failed 0
```

| Expected | Observed | |
|---|---|---|
| seen 2 | 2 | ✅ |
| inserted **0** | 0 | ✅ |
| skipped **2** | 1 + 1 across two throttled runs | ✅ (total) |
| failed 0 | 0 | ✅ |
| inquiries still 2 | 2, `distinct external_id` = 2 | ✅ |
| duplicates 0 | 0 | ✅ |
| work items still 0 | 0 | ✅ |

**Stronger than "skipped".** Both rows still carry `created_at == updated_at == 02:37:05` — the
re-collection did not merely decline to insert, it did not write to them at all. The `sourceUnchanged`
branch held on real data.

**It took three runs, not one.** That is the finding in §4, not a caveat on the result: the property
under test (re-collection inserts nothing and duplicates nothing) held across every attempt,
including the two the gateway cut short.

---

## 4. The defect the live run found — Coupang rate limit

The re-sweep took **HTTP 429 mid-sweep**. The first backfill had pushed ten calls through in 1.6s
(≈6/s) against a documented ceiling of **5 calls/s per vendorId** and got away with it; minutes later
the identical sweep did not.

**It failed safely** — a throttled page leaves the cursor untouched, the run records `PARTIAL`, and
the retry resumes. Nothing was lost, nothing was duplicated, and the dedupe result above is
undamaged. But a seller's first import should not need three attempts, and should not show them
"수집이 속도 제한으로 중단되었습니다".

**Fixed offline:** the sweep now paces itself to a minimum 250ms between signed calls — 4 calls/s,
under the documented ceiling with margin, because the limit is per vendorId and the order stream may
be sweeping the same vendor concurrently. The gap is measured from the last call, so a naturally slow
call costs nothing extra; only a burst pays. The pause is taken **before** signing, since a
signed-date is only valid for minutes and signing-then-sleeping would spend that budget on our own
throttle. Cost: ~2.5s added to a full backfill, on an already-asynchronous run.

**This fix is not itself live-verified.** It changes only call timing — not what is requested, read,
mapped, or stored — and per the operator's instruction no further live run was taken.

**Unproven risk carried to the order stream.** `CoupangOrdersClient` sweeps six statuses × pages with
the same absence of pacing and the same per-vendor limit. It has never been observed taking a 429,
and it was deliberately not modified in this unit: it is a live-proven path, and changing it on an
inference rather than an observation is how proven paths break. Recorded as a follow-up.

---

## 5. What was NOT proven, and why

**The routine chain (work queue → proposal → draft → Action Window entry) never ran.** Both collected
inquiries were already answered on the platform, so — correctly, by design — no work item opened. An
already-answered inquiry is stored as history and never surfaced as a seller task, because a queue
full of work already done trains an operator to ignore the queue.

The chain is proven offline end to end over H2 (`CoupangInquiryRoutineFlowTest`), including that a
platform answer completes an open task. What is missing is a live subject, and that cannot be
manufactured: it requires a real buyer to ask a real question. Per the operator's instruction, live
runs were **not** repeated in the hope of one arriving.

**No reply was posted.** The guided reply entry was in the sitting-2 manifest with `replies posted=0`,
and no reply was posted to any buyer. Bundling verifications into one run is efficient; bundling a
real answer to a real customer into a proof is not.

---

## 6. Sanitization

Every marketplace call in all three sittings was a read-only GET against `onlineInquiries` only. The
PII-bearing `callCenterInquiries` endpoint (`buyerEmail`, `buyerPhone`) was never called. No buyer
identity was stored, displayed, or logged. The backend log contains no credential, no inquiry text,
and no provider body; the credential evidence is length buckets, character classes, and per-run
salted digests.
