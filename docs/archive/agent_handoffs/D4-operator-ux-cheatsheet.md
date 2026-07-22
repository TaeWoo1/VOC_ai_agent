# D4 — Operator UX cheatsheet (Discord guarded action console)

_Operator-facing guide. Doc only — no code. Snapshot: `main @ d92a5ea` (2026-06-04)._

Governing rule: **Claude proposes; Python disposes.** The bot can draft and
propose, but a Python validator decides whether anything actually runs. Nothing
red runs from natural language — only from an exact deterministic phrase, and
only when the matching capability flag is set.

---

## 1. Actions

| Action | What it does |
|---|---|
| `render_report` | Render the seller business PDF into a staging dir. |
| `collect_reviews` | Run a live OliveYoung review collection via the runner. |
| `send_outreach` | Draft + (fake) final-send an outreach message. |
| `publish_post` | Draft + (fake) final-publish an Instagram package. |

## 2. Real vs fake/staging (read this first)

| Action | Reality today |
|---|---|
| `render_report` | **REAL** guarded render to a staging dir. Produces a real PDF; never mutates the source packet. |
| `collect_reviews` | **REAL** guarded collect via the runner. **May mutate the brand-20 queue + corpus DB** (idempotent `INSERT OR IGNORE`). |
| `send_outreach` | **FAKE** — preview + fake final-send only. No email leaves the machine. |
| `publish_post` | **FAKE** — preview + fake final-publish only. Nothing is posted to Instagram. |

`render_report` and `collect_reviews` cause real effects. `send_outreach` and
`publish_post` are inert simulations behind fake provider seams
(`_send_fn=_fake_send`, `_publish_fn=_fake_publish`).

## 3. Capability env flags

Each action's final/live tier is gated by an infra env flag. Unset = off.

| Action | Env flag |
|---|---|
| `render_report` | `AGENT_RENDER_ENABLED` |
| `collect_reviews` | `AGENT_COLLECT_LIVE_ENABLED` |
| `send_outreach` | `AGENT_SEND_ENABLED` |
| `publish_post` | `AGENT_PUBLISH_ENABLED` |

The flag is the **first key**. It is necessary but not sufficient — the second
key is the deterministic phrase (§4). Both must be present in the same turn.

## 4. Deterministic phrases (the second key)

| Phrase | Authorizes |
|---|---|
| `진행해` | Confirm an already-armed agent run (render confirm). |
| `라이브 수집 승인` | Live collect. |
| `최종 발송 승인` | Fake final-send. |
| `최종 게시 승인` | Fake final-publish. |

Phrases are matched per-turn, never persisted, and never inferred from
paraphrase. The exact phrase is required.

## 5. Phrase safety

- `진행해` **never** sends and **never** publishes — it only confirms an armed run.
- `라이브 수집 승인` → **collect only**.
- `최종 발송 승인` → **send only**.
- `최종 게시 승인` → **publish only**.
- A phrase for one kind never triggers another action. A wrong-kind phrase (or
  the planner's generic confirm) returns `*_no_pending`, or — for an armed final
  tier — returns `*_not_authorized` and **preserves** the pending so the correct
  phrase can still be used (the preview is never burned by a wrong attempt).

## 6. Side effects

What an action can actually change:

- **render** → writes a seller PDF into a **staging** dir only. Source packet untouched.
- **collect** → mutates the **brand-20 queue + corpus DB** via the runner; writes run artifacts under `outputs/agent_collect_runs/`.
- **send** → on fake success, appends one `result=sent` line to **`send_log.md`** in the packet. That is the only send mutation.
- **publish** → on fake success, appends one `result=published` line (with `content_hash` + fake `post_id`) to **`publish_log.md`** in the package. That is the only publish mutation.
- **`status.json` is never mutated** by send or publish.
- Approval audit records are appended to a gitignored JSONL log.

## 7. Still impossible today

- Real email; Gmail / SMTP / any email API.
- Real Instagram publish; Instagram API or browser automation; any network upload.
- Auto-send or auto-publish — there is no path that fires a red action without the matching phrase + flag in the same turn.
- Any send/publish triggered by generic NL or `진행해`.

## 8. Recommended operator workflow

1. **Preview first.** Issue the action request; the bot proposes and writes an inert preview to staging. Nothing real happens yet.
2. **Inspect the artifacts.** Open the staging preview (`*_preview.json` / `.md`), the asset manifest, rights review, and safety check. Confirm it is what you intend to send/publish.
3. **Then the final phrase — only when intended.** Type the exact phrase for that one action (`최종 발송 승인` / `최종 게시 승인`). This consumes the single-use pending.
4. **Never rely on broad NL for red actions.** Conversational confirmation
   (`진행해`, "go ahead", planner confirm) will not send or publish. If you did
   not type the action's exact phrase, the action did not happen.

## 9. Deployment / env-config cautions

- **Keep real-provider flags unset by default.** The four `AGENT_*_ENABLED`
  flags should be off in any shared/default environment; set them only in the
  specific turn/host where the effect is intended.
- **Fake providers are the current state** for send and publish — enabling
  `AGENT_SEND_ENABLED` / `AGENT_PUBLISH_ENABLED` today still only exercises the
  fake seams. The flag does not turn on a real provider because no real provider
  is wired.
- **Real provider integration requires a separate feasibility spike and explicit
  authorization** (Instagram = D4-4d.2, email = D4-4b.2). Swapping `_send_fn` /
  `_publish_fn` for a real seam must not happen before that spike plus this
  cheatsheet's operator-UX sign-off.

## 10. Failure states (what each message means)

| State | Meaning | Pending |
|---|---|---|
| `*_not_authorized` | Flag off and/or phrase absent at the final tier. | **Preserved** — retry with the correct phrase + flag. |
| `artifact_hash_mismatch` | The staged preview no longer matches what was proposed. | **Cleared** — re-preview from scratch. |
| `already_sent` / `already_published` | Identical content already in the ledger. | **Cleared** — duplicate blocked. |
| provider failure (`*_failed`, `provider_unavailable`, `rejected`) | The (fake) provider did not succeed. | Writes **no ledger line** — retry-safe; nothing recorded. |

Notes:
- Duplicate prevention for publish is enforced at the **confirm/publish gate, not
  at propose**. Re-proposing identical content can regenerate the inert staging
  preview (harmless), but the actual duplicate publish is blocked with
  `already_published`. Same shape for send via `send_log.md`.
- Pendings are single-use, per-operator, TTL 600s. Once consumed (or cleared),
  the phrase will not re-fire without a fresh propose.

---

## Appendix — Discord operator examples

Illustrative turn-by-turn flows. `>` = operator message, `bot:` = bot reply.
Conversational; not a literal transcript.

### 1. render_report (real guarded → staging PDF)

```
> render the seller report for <target>
bot: render prepared / blocked — preconditions checked, render armed (staging). Not run yet.
> 진행해
bot: render_done — staging PDF written. Source packet untouched.
```

### 2. collect_reviews (real guarded → queue/DB)

```
> collect reviews for <goodsNo>
bot: precondition result — collect armed (pending kind=collect). Not run yet.
> 라이브 수집 승인
bot: one of:
     - collect_done — runner ran, queue/DB updated (idempotent).
     - collect_rate_limited — cursor 429; retry_after ~90 min, no DOM recovery.
     - collect_manual_review — auth wall / human check / 403.
```

### 3. send_outreach (preview + FAKE final-send)

```
> draft an outreach send for <target>
bot: send_preview.json written to staging. Inert. Nothing sent.
> 최종 발송 승인
bot: send_done (provider=fake) — appended result=sent to send_log.md.   # requires AGENT_SEND_ENABLED=1
> 최종 발송 승인   (same content again)
bot: already_sent — duplicate blocked, no ledger line added.
```

### 4. publish_post (preview + FAKE final-publish)

```
> draft a publish post for <package>
bot: publish_preview.json written to staging. Inert. Nothing posted.
> 최종 게시 승인
bot: publish_done (provider=fake, post_id=fake-…) — appended result=published to publish_log.md.   # requires AGENT_PUBLISH_ENABLED=1
> 최종 게시 승인   (same content again)
bot: already_published — duplicate blocked at the confirm gate, no ledger line added.
```

### 5. Wrong-phrase examples (scope isolation)

```
> 진행해                         (with a send or publish pending)
bot: never sends, never publishes — only confirms an armed agent run.

> 최종 발송 승인                 (with a publish pending)
bot: send_no_pending — no publish happens; publish pending preserved.

> 최종 게시 승인                 (with a send pending)
bot: publish_no_pending — no send happens; send pending preserved.
```

### 6. Env-off examples (flag is the first key)

```
> 최종 발송 승인                 (AGENT_SEND_ENABLED unset)
bot: send_not_authorized — pending PRESERVED. Set the flag, then re-issue the phrase.

> 최종 게시 승인                 (AGENT_PUBLISH_ENABLED unset)
bot: publish_not_authorized — pending PRESERVED. Set the flag, then re-issue the phrase.
```
