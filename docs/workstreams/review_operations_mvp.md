# Review Operations MVP — Workstream Home

> **This is the status home for the review-operations wedge.** Update this document before stopping
> in every review-ops task. A router (`CLAUDE.md`, `docs/product_operating_model.md`) carries the
> *path* to this file; **state lives here**, not in the router.
>
> **Why this wedge.** Review operations is the narrowest slice that exercises the *entire* operating
> loop (`OBSERVE → ACQUIRE → NORMALIZE → UNDERSTAND → PRIORITIZE → ACT → ESCALATE → RESUME`) on one
> seller, one channel, end-to-end. It is the wedge, **not** the product — the same loop generalizes
> to every channel and data type (`docs/product_operating_model.md` §7).

- **Workstream:** Review Operations (acquisition → normalize → prioritize → guided response)
- **Wedge channel:** NAVER (Action Window reference precedent). Second channel not yet selected.
- **Status:** ACQUIRE live-verified once (NAVER, 2026-07-15, Run 4 — supervised, dev seller, local
  dev backend). **NORMALIZE + visibility proven end-to-end against a running local backend
  2026-07-23** over committed golden exports at the **real 25-column schema**
  (`contracts/review-export/naver/v1/`), with a parse gate that fails unreadable artifacts as
  `ARTIFACT_INVALID` and an empty export treated as an honest zero. Guided ACT remains offline.
  ⚠ **Not fully closed:** the export's `답글여부` is dropped, inflating the "needs a look" queue by
  ~33% on real data. **Nothing promoted in §4.1.**
- **Last updated:** 2026-07-23
- **Owner:** SellerOps product/engineering

---

## 0. Honesty preface (read before editing status)

- This doc **tracks** progress; it does not **grant** capability status. Capability truth is
  `docs/multi-channel-connector-roadmap.md` §4.1; lessons are `docs/channel_capability_ledger.md`.
- Never check a box to a level higher than §4.1 supports. "Live-verified once" ≠ "operational."
- Action Window review paths sit behind a **market-policy-clarification gate** and a live-run gate
  (fresh, single-use, in-turn approval naming channel/account/date/operator). A plan is never
  authorization (`CLAUDE.md`).
- No auto export/download/submit. The seller performs the platform action; SellerOps detects,
  validates, processes (`docs/product_operating_model.md` §4, §8).

---

## 1. Checklist (the wedge, loop-ordered)

Legend: `[ ]` not started · `[~]` in progress · `[x]` done + evidence linked · `[!]` blocked (name blocker) · `[-]` out of MVP scope

### CONNECT — get the channel into the seller center
- [ ] Channel add flow reaches review acquisition (per §4 acquisition procedure)
- [ ] Acquisition method chosen + declared in §4.1 for the wedge channel (`EXPORT` for NAVER)
- [ ] Connection health surfaces as one row in the shared observability model
- [ ] Seller can set **notification cadence** for review acquisition

### OBSERVE / ACQUIRE — minimum-action acquisition
- [ ] At cadence, seller is prompted with the **single** required action (e.g. "click review export")
- [ ] No hidden/chained clicks; manual progress always available (fence check)
- [ ] Export/download result captured by SellerOps (Action Window: detect, don't perform)
- [ ] Result validated (shape, channel, non-empty, sanitized) — **fail closed** on ambiguity
- [ ] Evidence linked: _[e.g. `docs/action-window-runtime/r4-evidence-pack.md` §8–17]_

### NORMALIZE
- [~] Ingested to canonical `review` model + dedup — **offline, over the committed golden export**
      (`ReviewAcquisitionSpineTest`). ⚠ Dedup keys on `external_id` (`리뷰글번호`), **not** on a
      fingerprint; `review-id-fingerprint/v1` parity is proven across the TS and Java ports on the
      same rows but is not what dedup keys on. The checklist line's "by fingerprint" wording
      overstates the implementation — reported, not silently re-scoped.
- [ ] Cross-channel-shaped (no NAVER-specific leakage into the core model)
- [x] Golden fixture(s) for the wedge channel's export form — `contracts/review-export/naver/v1/`
      (two committed workbooks at the **real 25-column schema** with the real `yyyy.MM.dd. HH:mm:ss`
      timestamp — one populated, one empty — plus `expected-rows.json`, loaded by the collector AND
      backend tests, with the FE asserting the same `expectedAttention` declaration)

### UNDERSTAND / PRIORITIZE
- [ ] Reviews classified (needs-response / risk / informational)
- [ ] Urgency + operational-risk signals computed (recencyBucket only; no internal timing surfaced)
- [x] Surfaced in the seller center with alerts (`docs/sellerops_frontend_spec.md`) — proven against a
      **running backend** 2026-07-23: a synthetic Action Window run reached a disposable local backend
      over HTTP and the attention API returned the contract's declared signals; the FE renders the
      honest headline **"현재 확인이 필요한 리뷰 N건"** from that same declaration. ⚠ Local dev backend
      only — no marketplace contact, nothing promoted in §4.1.
- [!] **Already-answered reviews are not excluded or badged** — the export states `답글여부` and the
      pipeline drops it, so the queue is inflated (33% of the low-rating rows in a real export were
      already answered). Blocker for calling this stage done; see the log entry below.

### ACT (bounded: prepare + guided only)
- [ ] Response **prepared** for a review needing reply
- [ ] Seller **guided** to post it (human-performed, observe-only; SellerOps does not submit)
- [ ] Posting recorded honestly — `UNVERIFIED` where no official API can confirm
- [ ] No autonomous outbound write anywhere in the path (fence check)

### ESCALATE / RESUME
- [ ] Human checkpoint returns a **decision**, not the whole workflow
- [ ] Loop resumes at next cadence without losing dedup/state

### GENERALIZE (proves it's not a 1-channel tool)
- [ ] Second channel selected with **its own** best acquisition method
- [ ] Same canonical model + same observability model — core unchanged
- [ ] Thesis check recorded: did the Action Window pattern survive the new channel? (`docs/multi-channel-connector-roadmap.md` §5.2)

---

## 2. Progress tracking format (use this each update)

Append a dated entry; never rewrite prior entries — correct forward.

```
### <YYYY-MM-DD> — <short title> — <STATUS>
- **Loop stage(s):** <OBSERVE/ACQUIRE/…>
- **Did:** <what changed, 1–3 lines>
- **Evidence:** <file/PR/run-id, or "none — offline">
- **§4.1 impact:** <"none" | "updated NAVER REVIEW live-verify col" — status changes go to §4.1 FIRST>
- **Ledger impact:** <"none" | new dated lesson in docs/channel_capability_ledger.md §2>
- **Gate state:** <policy gate / live-run approval — open or closed, why>
- **Blockers:** <named, or "none">
- **Next:** <single next verifiable step; each live/production step needs its own approval>
```

### Log

### 2026-07-22 — Review Acquisition Spine v1 — IMPLEMENTED (offline)
- **Loop stage(s):** ACQUIRE (artifact validation) → NORMALIZE → UNDERSTAND/PRIORITIZE (visibility)
- **Did:** Joined the two halves of review acquisition on ONE committed golden export
  (`contracts/review-export/naver/v1/`): the collector validates those exact bytes through the
  quarantine and the backend ingests the same file to operator attention signals. Gave the synthetic
  fixture page the real bytes + the browser driver an injected ingest seam. Added the honest
  review-ops number ("현재 확인이 필요한 리뷰 N건") from the existing attention endpoint and removed
  `CompletedResult`'s unbacked "정리·분석까지 끝냈어요" claim.
- **Evidence:** `docs/slices/review-acquisition-spine-v1.md`;
  `collector/test/action-window/review-acquisition-spine.test.ts` (16);
  `backend/.../ingest/ReviewAcquisitionSpineTest.java` (8);
  `frontend/src/components/AttentionSignalList.test.tsx` (3) + `lib/attention.test.ts`.
  **No live run** — offline only.
- **§4.1 impact:** none. Nothing live happened; `운영 지원` stays file-upload-only.
- **Ledger impact:** none.
- **Gate state:** no gate consumed. Market-policy gate and live-run approval both untouched and
  still closed; this slice needed neither.
- **Blockers:** none introduced. One finding **reported, not resolved**: quarantine `valid: true`
  does not imply ingestible (the sniff checks ZIP magic + the `[Content_Types].xml` entry name; the
  pre-spine fixture payload passed it and was not a workbook). Whether validation should gain a
  parse-level check is a `[PO]` call.
- **Next:** a single-process synthetic run (fixture → real local dev backend → attention) would
  close the last offline gap; it needs a running backend, not a gate.

### 2026-07-23 — Spine gaps closed against real-export evidence — IMPLEMENTED (offline)
- **Loop stage(s):** ACQUIRE (artifact validation) → NORMALIZE → UNDERSTAND/PRIORITIZE (visibility)
- **Did:** Regenerated the golden fixtures at the **real 25-column schema** with the real
  `yyyy.MM.dd. HH:mm:ss` timestamp (a `DateParse` branch the old date-only fixture never exercised),
  plus an empty-export artifact. Added a **parse gate at the validate seam** — a payload that passes
  the D-021 sniff but is not a workbook now fails as `ARTIFACT_INVALID` (true, actionable copy)
  instead of reaching ingest as `INGEST_FAILED` ("저장 중 문제…", false). Made an empty **export** an
  honest zero without breaking the manual-upload contract (provenance-based rule). **Ran the E2E for
  real**: synthetic Action Window → disposable local backend → attention API, 4/4.
- **Evidence:** `docs/slices/review-acquisition-spine-v1.md` §5–§6; collector 4843/95 (was 4822/91),
  backend 1370 (was 1366), frontend 666 (was 663) — every delta attributed in §6. Both new locks
  falsified and caught, hermetically **and** end to end.
- **§4.1 impact:** none. A disposable local backend is not marketplace live verification;
  `운영 지원` stays file-upload-only.
- **Ledger impact:** none.
- **Gate state:** no gate consumed; no live marketplace contact. The E2E ran under this turn's
  in-turn approval, on a synthetic page against a throwaway database that was dropped afterwards.
- **Blockers:** **`답글여부` is dropped by the canonical model.** On a real export 26 of 79 low-rating
  reviews (33%) were already answered, so the "needs a look" queue is inflated and the guided-reply
  path can produce a **duplicate public reply**. `IngestedReviewVocItemSource:383`'s comment ("an
  export carries no reply state") is false for NAVER. **The spine is not declared fully closed until
  this is dispositioned.** Investigated and dismissed: `관련리뷰상세내용` duplicates the linked
  review's own body (1,157/1,157 resolvable cases) — no data loss.
- **Next:** *Review reply-state ingest v1* — aliases → `CanonicalReview` field → `reviews.reply_state`
  + `replied_at` (Flyway V21) → populate the existing `replyStatus` DTO field, plus a `[PO]` decision:
  are answered reviews **excluded** from "needs a look" or **badged**? Separately, a `[PO]` wording
  approval is owed for the `decisions.md` entry covering the live-path validate tightening.

---

## 3. Gate register (review-ops specific)

| Gate | What it blocks | Current state |
|---|---|---|
| Market-policy clarification | Any seller-facing / production review acquisition via Action Window | _[open — see §4.1 note]_ |
| Live-run approval | Any live marketplace run | Requires fresh, single-use, in-turn approval (channel/account/date/operator) |
| Reply-submission gate (v1.6) | Guided review-reply going live | Offline; gate-locked (`contracts/action-window/v2/`) |

---

## 4. Related documents

- Operating model + user journey: `docs/product_operating_model.md`
- Capability truth: `docs/multi-channel-connector-roadmap.md` §4.1
- Channel lessons ledger: `docs/channel_capability_ledger.md`
- Action Window contract: `docs/slices/action-window-v1.md`
- Action Window runtime status: `docs/action-window-runtime/HANDOFF.md`
- Review acquisition spine slice: `docs/slices/review-acquisition-spine-v1.md`
- Shared golden export contract: `contracts/review-export/naver/v1/SPEC.md`
- Review response slices: `docs/slices/review-response-preparation-v1.md`, `docs/slices/review-response-completion-v1.md`
- Frontend source of truth: `docs/sellerops_frontend_spec.md`
