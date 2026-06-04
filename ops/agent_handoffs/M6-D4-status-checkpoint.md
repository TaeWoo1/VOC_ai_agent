# M6 / D4 status checkpoint

_Snapshot as of `main @ d92a5ea` (2026-06-04). Status doc only — no code change._

## 1. HEAD & milestone state

- **HEAD:** `main @ d92a5ea` (Merge PR #25).
- **Completed & merged:**
  - **D4-3a** render_report guarded execution — live render smoke passed.
  - **D4-3b / D4-3b2** collect_reviews guarded live execution — live + resume smokes passed.
  - **D4-3b2-fix** cursor-429 → `collect_rate_limited` mapping fix.
  - **D4-4a** send_outreach preview/draft — smoke passed.
  - **D4-4b** fake final-send approval — smoke passed.
  - **D4-4c** publish_post preview/draft — smoke passed.
  - **D4-4d** fake final-publish approval — **completed & smoke-tested** (PR #25 merged; fake final-publish smoke passed; no real publish).
- **Next planned:** none in the fake-provider track — the four-action guarded lane (render / collect / send / publish) is now complete. Remaining work is real-provider feasibility spikes (later, separately authorized).

## 2–3. Action matrix (supported actions & execution class)

| Action | Class today | Notes |
|---|---|---|
| `render_report` | **real guarded execution** | env-gated live PDF render into staging |
| `collect_reviews` | **real guarded execution** | live OY collection via runner subprocess |
| `send_outreach` | **preview + fake final-send** | `_send_fn=_fake_send`; preview is staging-only |
| `publish_post` | **preview + fake final-publish** | `_publish_fn=_fake_publish`; preview is staging-only |

(Real email provider, real Instagram publish = **unavailable** — fake seams only.)

## 4. Current gates

| Action | env flag | deterministic phrase | pending kind | approval_log stage |
|---|---|---|---|---|
| render_report | `AGENT_RENDER_ENABLED` | `진행해` (confirm) | `render` | `render_pdf` |
| collect_reviews | `AGENT_COLLECT_LIVE_ENABLED` | `라이브 수집 승인` | `collect` | `collect_execute` |
| send_outreach | `AGENT_SEND_ENABLED` | `최종 발송 승인` | `send` | `prepare_send`, `send_final` |
| publish_post | `AGENT_PUBLISH_ENABLED` | `최종 게시 승인` | `publish` | `prepare_publish`, `publish_final` |

All pendings are single-use, per-operator, TTL 600s. Phrases are per-turn, never persisted.

## 5. Side effects allowed today

- **render:** writes a seller PDF into a **staging** dir only (packet never mutated).
- **collect:** mutates the **brand-20 queue + corpus DB** via the runner (idempotent INSERT OR IGNORE), writes artifacts under `outputs/agent_collect_runs/`.
- **send:** on fake success appends one `result=sent` line to **`send_log.md`** in the (constructed/target) packet — the only send packet mutation. Preview writes `send_preview.json`/`.txt` to staging.
- **publish:** on fake success appends one `result=published` line (with `content_hash` + fake `post_id`) to **`publish_log.md`** in the (constructed/target) package — the only publish package mutation. Preview writes `publish_preview.json`/`.md` to staging.
- **approval_log:** append-only audit records (gitignored jsonl).

## 6. Still impossible today

- Real email send; Gmail/SMTP/API connection.
- Real Instagram publish; Instagram API / browser automation; any network upload.
- Auto-send after render/collect; auto-publish after render/preview.
- Any send/publish from generic NL or `진행해`.

## 7. Phrase safety invariants

- Generic `진행해` **never** sends or publishes (only confirms an armed agent run).
- `라이브 수집 승인` authorizes **collect only**.
- `최종 발송 승인` authorizes a fake **send only**, and only with `AGENT_SEND_ENABLED`; `send_not_authorized` preserves the pending.
- `최종 게시 승인` authorizes a fake **publish only**, and only with `AGENT_PUBLISH_ENABLED`; `publish_not_authorized` preserves the pending.
- Action scopes are separated: a phrase for one kind never triggers another (wrong-kind → `*_no_pending`).
- RED final tiers re-verify an **artifact_hash** against the staged preview before any execution; idempotency ledgers (`send_log.md` / `publish_log.md`) block duplicates; failures are fail-closed (no ledger line).
- `evaluate_preconditions`, `brand20_queue`, runner, persistence, Phase 2E, report templates, and `english_copy_validator` logic are unmodified by D4-3/D4-4.

## 8. Smoke artifacts left for inspection (gitignored `outputs/`)

- **render (D4-3a):** live render smoke passed; staging PDF path not retained on disk this session.
- **collect (D4-3b2):** `outputs/agent_collect_runs/A000000107679__DATETIME_DESC__20260604T080056Z_23868/` and `…__084008Z_56978/` (+ `outputs/agent_collect_smoke/`).
- **send preview (D4-4a):** `outputs/agent_send_preview_smoke/`.
- **fake final send (D4-4b):** `outputs/agent_send_final_smoke/`.
- **publish preview (D4-4c):** `outputs/agent_publish_preview_smoke/`.
- **fake final publish (D4-4d):** `outputs/agent_publish_final_smoke/`
  - package: `outputs/agent_publish_final_smoke/packages/package_smoke_publish_final_001`
  - staging: `outputs/agent_publish_final_smoke/staging/package_smoke_publish_final_001`
  - result: `propose_publish_preview` → `action_propose` (pending kind=publish) → `AGENT_PUBLISH_ENABLED=1` + `최종 게시 승인` → fake `publish_done`, `post_id=fake-3aa9f3b504b6`, `publish_log.md` appended; duplicate same content blocked `already_published` at the confirm gate; no `status.json` mutation; no tracked smoke changes.

## 9. Known nuance

- **Publish duplicate prevention is enforced at the confirm/publish gate, not at propose.** `_already_published` is checked in `confirm_publish_final` (the point of publication). Re-proposing identical content **can regenerate the inert staging preview** (harmless — no package mutation, no publish), but the actual duplicate publish is blocked with `already_published`. The no-duplicate-publish guarantee holds; only the inert preview is reproducible. (Same shape applies to send via `send_log.md`.)

## 10. Recommended next steps

- **Real Instagram publish provider** — feasibility spike **only**, later & separately authorized (D4-4d.2). Swap `_publish_fn` for a real seam; everything else (gate, artifact_hash, ledger, audit) stays.
- **Real email provider** — feasibility spike **only**, later & separately authorized (D4-4b.2; Gmail/SMTP/API behind its own capability flag).
- **Before any real provider:** document operator UX (phrase/gate cheatsheet, failure-state messaging) and deployment/env config (which capability flags are set where, secret handling, who can set per-turn authorization). No real-provider code until that doc + explicit authorization exist.
