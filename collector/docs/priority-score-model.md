# SellerOps priority-score model — specification (docs-only)

> **Specification only — NO implementation.** This PR documents the scoring
> philosophy, allowed/forbidden inputs, a draft weighting model, score bands, audit
> requirements, and deferred work. There is **no** `priorityScoreFor`, **no**
> `prioritizeEvents`, and **no** scoring/ranking code in this branch. Offline; no AI;
> no live collection.

## 1. Why this layer exists

The attention-signal layer (`attention-signal-model.md`) says *why* one event may need
attention; the digest (`attention-digest-model.md`) says *what kinds* are accumulating.
Neither answers the seller's real daily question:

> **"Which events should I look at first today?"**

The priority score is the layer that produces a ranked, explainable ordering. It is
**product judgment**, not just plumbing — so it is specified before any code, so the
weighting and guardrails are agreed before they are encoded.

## 2. What the score is and is not

**The score IS:**
- a deterministic, auditable ordering hint over events ("look at this first")
- explainable via reason codes
- derived only from already-sanitized, coarse signals

**The score is NOT:**
- exact business value
- exact financial loss
- an automatic action decision
- an AI confidence score
- a platform trust score

It is an attention-ordering aid for a human, never an automated actuator.

## 3. Allowed inputs

Only coarse, already-sanitized signals:

- attention signals (`AttentionSignal` / `AttentionSignalCode`)
- the attention digest (batch context)
- sanitized summaries (`SellerOpsSanitizedSummary`)
- event kind (`SellerOpsEventKind`)
- severity (`AttentionSignalSeverity`)
- reply status (review/inquiry, coarse enum)
- claim status (coarse enum)
- rating bucket (coarse)
- sales amount **bucket** (coarse — never the exact amount)
- platform / channel coarse tags
- *future* safe recency / age **bucket** — once such a field exists

## 4. Forbidden inputs

The score must **never** read:

- raw review body / title / option
- raw inquiry body / title / content
- claim reason text
- exact sales amount
- exact order / claim count
- buyer / reviewer / seller identity
- product / order / review / claim / shipment refs
- account ID
- seller ID
- Master ID
- API key / JWT / token
- raw URL / raw HTML / screenshots

If a desired factor needs one of these, it is **deferred** until a safe coarse field
exists — never satisfied by reading raw content.

## 5. Scoring philosophy

1. **Review pain matters** — reviews are the differentiation axis.
2. **Unanswered work matters** — inquiries/replies create daily usage.
3. **Claims matter** — they represent operational risk.
4. **Sales context is a coarse importance multiplier**, not exact accounting.
5. **Multiple independent signals compound** priority.
6. **No single signal creates irreversible automation.**
7. **Human approval remains required** for outward actions.
8. **The score explains itself** with reason codes.
9. **The score is deterministic and auditable.**
10. **AI can later explain clusters**, but AI must **not** be required for base scoring.

## 6. Draft weighting model (to document, not implement)

> Illustrative starting point for discussion — subject to calibration before any code.

**Base severity weight** (per signal):

| Severity | Weight |
|----------|--------|
| high | 70 |
| medium | 40 |
| low | 10 |

**Signal co-occurrence bonus** — multiple high/medium signals on the *same* event
should add a bonus (compounding, principle 5), e.g. a flat increment per additional
high/medium signal beyond the first. Exact curve TBD at implementation.

**Sales importance multiplier** — derived from `amountBucket` only:
- `100m_plus`, `10m_to_100m` → increase attention (larger multiplier)
- lower buckets → neutral / smaller
- `unknown` → neutral (never penalize for missing data)
- never use the exact amount.

**Future recency factor** — *deferred* until a safe timestamp/age **bucket** exists.

**Future repeat / cluster factor** — *deferred* until a dedup/cluster model with a safe
grouping key exists.

These numbers are a **draft for discussion**, not a locked contract; calibration is a
separate, explicit step.

## 7. Score bands

The numeric score maps to a coarse band for display (thresholds TBD at calibration):

- `low`
- `medium`
- `high`
- `urgent`

Bands are what the UI shows; the raw number stays for ordering/audit.

## 8. Explanation / audit requirements

Every score must be **self-explaining and reproducible**:

- the contributing **signal codes** are carried alongside the score
- the **reason codes** (which weights/bonuses/multipliers applied) are recorded
- given the same sanitized inputs, the score is **identical** (deterministic)
- nothing in the explanation exposes a forbidden input

### Conceptual future output shape (NOT implemented here)

```ts
interface PriorityScoreExplanation {
  score: number;
  band: "low" | "medium" | "high" | "urgent";
  signals: AttentionSignalCode[];
  explanationCodes: string[];
}
```

**This is conceptual only — there is no TypeScript implementation in this PR.**

## 9. Deferred work (and why)

- **Exact recency scoring** — deferred until safe age **buckets** exist (raw
  timestamps are not exposed in sanitized summaries).
- **Deduplication** — deferred until a safe, stable grouping key exists (event ids and
  refs are intentionally not in the summaries).
- **Product-level clustering** — deferred until a safe product grouping strategy exists.
- **AI classification / summaries** — deferred until prompt/data boundaries are written;
  AI must not be required for base scoring.
- **Automatic reply / posting** — **excluded** (human approval required; out of scope
  entirely for this layer).

## 10. Future implementation checklist (when approved)

1. Add `priorityScoreFor(event, context?)` — pure, reads only allowed inputs.
2. Add `prioritizeEvents(events)` — deterministic ordering + `PriorityScoreExplanation[]`.
3. Encode the weighting model from §6 behind named constants (calibratable).
4. Carry signal codes + reason codes in the explanation (§8).
5. Map score → band with documented thresholds (§7).
6. Tests: determinism, band thresholds, co-occurrence compounding, sales multiplier
   from bucket only, **no-leak sweep**, module boundary (no network/fs/browser/env/AI).
7. Keep recency/dedup/cluster factors stubbed/deferred per §9 until safe fields exist.

## Out of scope (now)

Live NAVER / ESM / browser / Playwright · AI calls / model prompts · scoring or ranking
implementation · credentials / seller IDs / Master ID / API key / JWT · backend · DB ·
upload · RUN_INTEGRATION · real data. NAVER live work is **paused**; ESM live/API/
credential work is **deferred**.
