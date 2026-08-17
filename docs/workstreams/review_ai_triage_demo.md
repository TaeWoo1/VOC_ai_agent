# Review AI Triage — Demo Home (canonical entry point)

**Read this first when the request is "리뷰 AI 데모 준비하자" or anything like it.** Everything an
operator needs to run the demo, and everything the demo must not claim, is here or one link away.
Last updated 2026-08-17 (unit: `feat/review-ai-triage-demo-ready-v1`).

## 0. The product question, fixed

> **이 리뷰로 인해 판매자가 확인하거나 조치할 일이 있는가?**

This is seller **actionability** detection, not sentiment. Every event below is evidence about that
one question — RUBRIC v2 §2.3.

## 1. Status in one paragraph

Candidate **C2** — exact classifier version
`llm-triage/v1+openai:gpt-5-2025-08-07+triage-prompt/v4+schema/v1+tdefault+out4000+effort:low+additive-guard/v1`
— runs as a **conservative production pilot candidate**. **It is NOT a PASS.** Its only measured
evidence is the development store's 220 NAVER gold rows (all in-sample; the v2 holdout is spent and
sealed) and one pilot funnel data point. `ReviewTriageRules` still owns every seller-facing tier; C2
may only **add** an `AI 확인 필요` suggestion. Off by default. The next verification is a **fresh
holdout from a second real seller** (RUBRIC v2 §13); the spent holdout is never reused.

## 2. Channels and capabilities (`contracts/review-triage-events/v1/CONTRACT.md` §1)

| channel | AI `확인 필요` suggestion | see the original | reply | notes |
|---|---|---|---|---|
| NAVER | yes | none (no per-review URL, no locate surface) | guided copy-paste on the attention surface, never verified | first pilot org's 3,880-row corpus |
| CAFE24 | yes | none | **no flow built** | reviews arrive via board-4 sync / reconcile |
| COUPANG | yes | **`[쿠팡에서 보기]` locate run** (Action Window, local agent) | **none — the channel has no reply feature; no reply event can be written, ever** | policy gate: pilot allowed, GA gated; D6 amended for this pilot only (§6.1.2) |
| any other | **outside**: 404 on every triage route, `UNCLASSIFIED` at the gate, no UI control | — | — | GMARKET etc. |

Stated once in code: `ReviewTriageChannelCapability`; sent on the page as `channel`.

## 3. Enable (env, off by default)

`backend/.env.local` (git-ignored), then `set -a; . ./.env.local; set +a; ./gradlew bootRun`:

```
SELLEROPS_AI_TRIAGE_PILOT_ENABLED=true
SELLEROPS_AI_TRIAGE_PILOT_ORG_IDS=<org uuid[,org uuid]>
SELLEROPS_AI_TRIAGE_API_KEY=<vendor key>            # never logged, stored or versioned
# defaults = C2: OPENAI / gpt-5-2025-08-07 / omit-temperature / out 4000 / effort low / max-per-run 100 (≤500)
```

An org not listed sees the pre-pilot screen byte-for-byte. Restart the backend after changing it
(a long-lived `bootRun` is a version pin).

## 4. Bounded run (operator-triggered; nothing classifies on import, ever)

```
POST /api/seller-accounts/{accountId}/channel-reviews/ai-triage/runs?limit=N   # N ≤ max-per-run, newest first
GET  /api/seller-accounts/{accountId}/channel-reviews/ai-triage/funnel
GET  /api/seller-accounts/{accountId}/channel-reviews/{reviewId}/triage-feedback/events
```

Run: 409 if one is already running on the account; 400 if the org is not enabled; 404 outside the
three channels. Response = counts only (`considered/classified/marked/failed/refused/remaining`).
Payload to the vendor = **rating + body, nothing else** (RUBRIC §8.4, asserted against the whole
outgoing request in `TriageFailClosedTest`).

## 5. Demo order (operator)

1. Backend up with §3 env for the demo org; frontend up; log in as that org.
2. Per channel: open **채널 → 상품평**. Point out: rules tier chips, `aiPilotEnabled`, the channel row
   (Coupang shows `[쿠팡에서 보기]`; NAVER/Cafe24 show the "원문 이동 불가" line instead).
3. Press one bounded run per account (§4, `limit` 25–50). Reload the list.
4. If a row is marked: `AI 확인 필요` chip beside the rules chip, sorted with 확인 필요, disclosure line
   in the detail. Press 확인 필요가 맞아요 / 조치 시작 — **the row does not move, nothing is hidden**.
5. Coupang: press `[쿠팡에서 보기]` (needs the paired local agent + WING tab).
6. Show `GET …/funnel` and `GET …/{reviewId}/triage-feedback/events` — the same spine, three channels.
7. Say out loud: pilot candidate, not PASS; no marketplace write; second-seller holdout pending.

## 6. Events, funnel, and what is separate

Vocabulary (contract §2): `AI_ATTENTION_SHOWN`, `REVIEW_OPENED`, `ORIGINAL_OPENED`,
`MARKETPLACE_LOCATED`, `AI_AGREE`/`AI_DISAGREE`, `RULE_AGREE`/`RULE_DISAGREE`, `ACTION_STARTED`,
`ACTION_COMPLETED`, `ACTION_NOT_NEEDED`, and channel-gated `REPLY_DRAFTED`/`REPLY_SUBMITTED` (NAVER
only; refused 400 on Cafe24/Coupang). **No `IGNORED`** — absence is never an event, never a label.

Funnel (distinct reviews, counts not rates): marked → aiAttentionShown → reviewOpened →
originalOpened / marketplaceLocated → aiAgree / aiDisagree → actionStarted → actionCompleted (+
actionNotNeeded, replyDrafted, replySubmitted).

Four records, four tables (contract §3): **classifier prediction** (`review_triage_predictions`,
immutable) · **displayed decision** (`review_triage_ai_current` + `shown_tier/shown_source` stamped
on every event, resolved server-side by `TriageDisplayDecision` — never client-asserted) · **explicit
feedback** (`review_triage_corrections` + dispositions `CLASSIFIER_ERROR` vs `SELLER_PREFERENCE`) ·
**behaviour / actions** (append-only). Silver rules (contract §4): explicit answers strong;
`ACTION_*`/`REPLY_*` strong positive; open/original/located weak; **weights are a snapshot-time policy
— none hardcoded**; silver and correction snapshots are separate; nothing trains the running model.

## 7. Not done (deliberately)

no seller-specific policy layer · no silver weights · no auto-classification on import · no online
learning · no marketplace write · no Coupang reply (none exists) · no Cafe24 reply flow · no per-review
original link on NAVER/Cafe24 · reply hooks from the attention surface not wired · **no fresh holdout
yet** — a second real seller's corpus is the next gate; the spent v2 holdout is sealed
(`holdout-spent.json`) and never reused.

## 8. Live evidence (2026-08-17, real PostgreSQL 15, first pilot org, backend from `.env.local`)

| account | considered | classified | marked (AI-added) | failed | refused |
|---|---|---|---|---|---|
| CAFE24 (3 rows, uploaded from the locally stored board-4 REVIEW articles) | 3 | 3 | 0 | 0 | 0 |
| COUPANG (22 rows from the Action Window acquisition) | 22 | 22 | 0 | 0 | 0 |
| NAVER (`limit=10`, newest pending) | 10 | 10 | 0 | 0 | 0 |

- **LIVE_PROVEN:** NAVER / Cafe24 / Coupang vendor classification path through the three-channel gate;
  the key never reached the log; V44 applied on PG; outside-channel (GMARKET) 404 on run/funnel;
  Cafe24/Coupang `REPLY_*` → 400; feedback routes and per-review event timelines on all three channels
  (`RULE_DISAGREE`, `ACTION_STARTED`, `REVIEW_OPENED`, `ORIGINAL_OPENED`, `MARKETPLACE_LOCATED` via API);
  Cafe24 UI: controls present, no locate button, "원문 이동 불가" line.
- **This session's AI-added marks: 0.** The only live mark → ordering → funnel proof remains the
  **earlier single NAVER row** (funnel 1/1/1/0/0/1/0/1/0…).
- **TEST_PROVEN (integration-tested, not independently live-proven):** the Cafe24 / Coupang mark →
  ordering → funnel path (`ChannelReviewAiPilotIT` exhaustive additive proof, `AiTriagePilotServiceTest`).
- **NOT LIVE_PROVEN:** Coupang `MARKETPLACE_LOCATED` from a real local-agent press (unit-tested only).

## 9. Pointers

`docs/slices/llm-triage-classifier-v1.md` (§14–§16) · `contracts/review-eval/naver/v2/RUBRIC.md`
(§2.3, §8.3/§8.3.1, §12–§13) · `contracts/review-triage-events/v1/CONTRACT.md` ·
`docs/slices/production-triage-feedback-draft-v1.md` §7–§8 · `docs/coupang_review_policy_gate_v1.md`
§6.1.2.
