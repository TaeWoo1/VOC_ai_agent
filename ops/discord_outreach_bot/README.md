# Discord Outreach Operator Bot — v0.1 (CLI) + v0.2 (Discord transport)

A thin **operator surface** over the `outreach_packet` workflow. It removes the
copy-paste loop (Claude log → ChatGPT → hand-written next prompt) by reading
each packet's state and **generating the next Claude prompt for you**, with the
standing guardrails already baked in.

**v0.1 is the CLI** (`cli.py`). **v0.2 adds a Discord slash-command transport**
(`discord_bot.py`) that calls the *same* read-only core and posts compact
replies. v0.2 is a transport layer only — it adds **no** new capability beyond
v0.1: it cannot send, collect, render, commit, or mutate a packet. Its single
write path is the **append-only approvals log**.

`discord.py` is **not installed** in this environment, so the adapter code ships
ready to run but the package is not installed (see *Running the Discord bot*).
`discord_bot.py` imports cleanly without `discord.py`; only `run_bot()` needs it.

> Ownership: AI-SCAFFOLD ops glue. No business logic lives here — the workflow
> rules, gates, and copy live in `.claude/skills/outreach_packet.md` and
> `docs/ops/outreach_packet_runbook.md`. This tool only reads them and the
> per-packet `status.json` / `send_log.md`.

## Hard invariants (by construction)

- **Read-only.** Never writes a packet file, never edits `status.json` /
  `send_log.md` / `email_body.txt` / PDFs.
- **Never sends email.** `outreach:mark_sent` records an operator's *manual*
  send during a real Claude turn — the bot doesn't do it.
- **Never runs live OY collection** and never auto-retries after 429 / DOM
  failure.
- **Never bypasses the claim-risk gate** — it surfaces it in the prompt.
- **Never commits.**
- Every 🔴 gate (collect_execute / render_pdf / prepare_send / follow_up) stays
  an operator-authorized step; the bot only generates the prompt + flags the gate.

## Files

| File | Role |
|------|------|
| `cli.py` | argparse entrypoint wiring the 6 commands |
| `status_reader.py` | read-only loader: `status.json` (3 packets) + `send_log.md` fallback for legacy packets (Menokin/Dewytree) |
| `prompt_builder.py` | 14-state happy path + `SENT` (post-send, behaves like `SCHEDULED` → `outreach:follow_up` 🔴) + terminals; gate map, standing guardrails, prompt generation |
| `followups.py` | follow-up due tracking across all packets |
| `discord_formatting.py` | **v0.2** pure formatting helpers — compact Discord strings over the read-only core (no `discord.py` dep, fully unit-tested) |
| `approval_log.py` | **v0.2** append-only operator-approval log (`approvals.log.jsonl`); records intent only |
| `discord_bot.py` | **v0.2** Discord slash-command transport (guarded `discord.py` import) |
| `discord_adapter.py` | *superseded* by `discord_bot.py` — original v0.1 design stub, kept for reference |
| `config.example.yaml` | settings for the Discord transport (v0.1 CLI needs none) |

The v0.1 CLI core is stdlib only. The v0.2 transport adds two optional deps:
`discord.py` (only for `run_bot()`) and `pyyaml` (only to read `config.yaml`;
sensible defaults apply without it). Neither is required to import the modules
or run the test suite.

## Commands

```bash
PY=/Users/taewookang/.pyenv/shims/python3

$PY ops/discord_outreach_bot/cli.py list_targets
$PY ops/discord_outreach_bot/cli.py show_status   <slug>
$PY ops/discord_outreach_bot/cli.py next_action   <slug>
$PY ops/discord_outreach_bot/cli.py build_prompt  <slug> [--stage corpus_review]
$PY ops/discord_outreach_bot/cli.py new_candidate --brand B --product P --goods-no G [--slug s]
$PY ops/discord_outreach_bot/cli.py followups      [--today 2026-05-31]
$PY ops/discord_outreach_bot/cli.py validate_packet <slug>
```

### Starting the next target (`new_candidate`)

A brand-new candidate has no packet folder yet, so `build_prompt <slug>` can't
help. `new_candidate` emits a ready `outreach:candidate_check` prompt from CLI
args **without creating any files** — the read-only entry point for the next
target. Folder / `status.json` scaffolding is deferred to v0.2 and happens only
after the operator confirms the candidate is a GO.

Slugs may be a unique prefix. `--targets-dir` overrides the packets dir.

### Example: `list_targets`

```
7 outreach target(s):

  🔴 UNKNOWN              beplain_mungbean_cleansing_balm_v1  (...)  [files-only]
  🔴 UNKNOWN              듀이트리 AC딥 진정 마스크            (...)  [send_log.md]
  🔴 PARKED               런드리유 (Laundryou)                (...)  [status.json]
  🔴 SCHEDULED            메노킨                              (...)  [send_log.md]
  🔴 SCHEDULED            에스네이처 (S.NATURE)               (...)  [status.json]
  🔴 SCHEDULED            휩드 (Whipd / WHIPPED)              (...)  [status.json]
```

`[status.json]` = full source of truth · `[send_log.md]` = legacy packet,
state inferred · `[files-only]` = draft, no state yet.

### Example: `followups --today 2026-06-08`

```
  [⚠ OVERDUE by 3d] 메노킨 (menokin_quick_bubble_mask_v2)  due 2026-06-05  [SCHEDULED]
  [● DUE TODAY]     에스네이처 (S.NATURE) (...)  due 2026-06-08  [SCHEDULED] → mkt@snature.kr
  [● DUE TODAY]     휩드 (Whipd / WHIPPED) (...)  due 2026-06-08  [SCHEDULED] → business@whipped.co.kr
```

### Example: `build_prompt <slug>`

Emits a ready-to-paste Claude prompt: target identity, current state, the next
`outreach:*` move + its gate, the stage instruction, **all standing
guardrails**, and the required output format. A `--stage` that doesn't match
the current state prints a confirmation note rather than silently proceeding.

## Running the Discord bot (v0.2)

The Discord transport wraps the exact same read-only functions. Slash commands:

| Slash command | Calls | Effect |
|---------------|-------|--------|
| `/outreach_list` | `format_list` | all targets + gate/state/recipient/follow-up |
| `/outreach_status slug:` | `format_status` | compact per-target status |
| `/outreach_next slug:` | `format_next` | recommended next move + gate |
| `/outreach_prompt slug: [stage:]` | `build_prompt_delivery` | next Claude prompt; if > 2000 chars, saved to `generated_prompts/` and the path is returned |
| `/outreach_followups [today:]` | `format_followups` | due / overdue / upcoming |
| `/outreach_validate slug:` | `format_validate` | required-files check for the state |
| `/outreach_approve slug: stage: [mode:prompt_only] [notes:]` | `record_approval` | **records operator intent only** to `approvals.log.jsonl` — does NOT execute the stage |

Replies are **ephemeral** (visible only to the operator who ran the command).
The operator allowlist is **fail-closed**: an empty `allowed_operator_ids`
blocks everyone.

Setup (run only after the operator approves installing the package):

```bash
PY=/Users/taewookang/.pyenv/shims/python3

$PY -m pip install 'discord.py>=2.3'      # optional dep; not installed here
cp ops/discord_outreach_bot/config.example.yaml ops/discord_outreach_bot/config.yaml
#   then fill in discord.guild_id + discord.allowed_operator_ids
export DISCORD_BOT_TOKEN=...               # never hard-code / commit the token
$PY ops/discord_outreach_bot/discord_bot.py
```

Without `discord.py`, `run_bot()` raises a clear `NotImplementedError` with the
install steps; the CLI (v0.1) keeps working unchanged. Set `discord.guild_id`
for instant per-guild slash-command sync during dev (global sync can take ~1h).

## What v0.1 does

- Lists every target with its workflow state and source of truth.
- Compact per-target status (corpus size, approved angle, recipient, schedule,
  follow-up, response).
- Infers the next allowed move from state, including 🔴 approval gates.
- Generates the next Claude prompt with guardrails embedded (the core
  copy-paste killer).
- Tracks follow-up due dates across packets with overdue / due-today flags.
- Validates that the files required for a packet's current state exist.
- Reads both the new `status.json` packets and legacy `send_log.md`-only ones.

## What v0.1 intentionally does NOT do

- No Discord connection (deferred to v0.2; `discord_adapter.py` is a design stub).
- No writes of any kind — does not advance state, edit packets, or commit.
- No email send, no live collection, no 429/DOM retry, no PDF render.
- No claim-risk decision — it surfaces the gate; the operator/agent decides in a turn.
- No database. No network. Pure local file read + stdout.

## Running tests

A small read-only suite lives at `tests/discord_outreach_bot/` (uses
`unittest.TestCase`, so it runs under both pytest and the stdlib runner). It
covers `status_reader` (discovery, `status.json` + legacy `send_log.md`,
brand/follow-up fallbacks), `prompt_builder` (state→move mapping, SCHEDULED /
PARKED / COLLECTION_READY prompt content, stage-mismatch warnings), `followups`
(overdue / due-today / upcoming math), and a CLI smoke check.

```bash
PY=/Users/taewookang/.pyenv/shims/python3

# pytest (default-collected via testpaths = ["tests"])
$PY -m pytest tests/discord_outreach_bot/ -q

# or stdlib unittest, no pytest required
$PY -m unittest discover -s tests/discord_outreach_bot -t .
```

The tests are **read-only by contract**, matching the bot itself: they write
only to `tempfile` dirs, never to `outputs/outreach/new_targets/`, and require
no network, Discord, or Chrome/CDP. Real-packet assertions are tolerant — they
skip if the live data has moved on rather than mutating it. Keep any new tests
read-only too.

## Approvals log (`approvals.log.jsonl`) — implemented in v0.2

`/outreach_approve` captures *operator intent* without ever performing the gated
action itself. It writes one JSON object per line to an **append-only**
`approvals.log.jsonl` (`approval_log.py`, opened in `"a"` mode — there is no
update/delete path). The bot writes ONLY here — never into a packet's
`status.json` / `send_log.md` (that stays the agent's job, written during the
authorized Claude Code turn).

Each record (every field always present):

| Field | Meaning |
|-------|---------|
| `timestamp_utc` | ISO-8601 UTC of the operator decision (e.g. `2026-06-08T02:00:00Z`) |
| `operator_discord_id` | Discord user id who ran `/outreach_approve` |
| `operator_display_name` | display name if available, else `null` |
| `target_slug` | packet the decision applies to |
| `current_state` | packet state at decision time (read from `status.json`) |
| `approved_stage` | the `outreach:*` move being authorized (prefix stripped, e.g. `render_pdf`) |
| `execution_mode` | `prompt_only` (the only mode v0.2 records); `local_run` / `manual_record` reserved for a future runner |
| `prompt_hash` | `sha256:` of the exact generated prompt (tamper / version evidence) |
| `prompt_preview` | first ~200 chars, single-lined, for human-readable audit |
| `notes` | free-text operator note (optional) |
| `source` | `discord` |

Example line:

```json
{"timestamp_utc":"2026-06-08T02:00:00Z","operator_discord_id":"123456789","operator_display_name":"founder","target_slug":"snature_aqua_squalane_cream_v1","current_state":"SCHEDULED","approved_stage":"follow_up","execution_mode":"prompt_only","prompt_hash":"sha256:…","prompt_preview":"Use the outreach_packet workflow …","notes":"no reply by due date; light nudge approved","source":"discord"}
```

**The log records intent; it does not bypass a red gate.** Running
`/outreach_approve`:
- does NOT send email, run collection, render a PDF, commit, or mutate a packet;
- only records that the operator authorized `approved_stage` for `target_slug`;
- the 🔴 action still runs as an operator-authorized Claude Code turn (or, later,
  a `local_run` runner that re-checks the matching record and still honors every
  standing guardrail).

So the gates stay human: `collect_execute`, `render_pdf`, `prepare_send`, and
`follow_up` each require a fresh approval record, and a reply that crosses an
approval boundary (new send, alternate channel, public posting) needs a new
record — the prior one does not transfer.

## Live Discord smoke test (dev guild)

A one-time, operator-run setup to prove the transport end-to-end in a **private
dev server**. Nothing here is autonomous: the bot stays read-only, the only
write is the append-only approvals log, and every 🔴 gate still runs in a real
Claude Code turn. Run these steps yourself — the agent does not connect to
Discord, install packages, write `config.yaml`, or write `approvals.log.jsonl`.

### A. Create the Discord application + bot
1. Go to <https://discord.com/developers/applications> → **New Application**
   (e.g. name it `kbeauty-outreach-dev`).
2. Left sidebar → **Bot** → **Add Bot** → confirm.
3. **Privileged Gateway Intents:** leave **all OFF.** The bot uses
   `discord.Intents.default()` and slash commands only — it never reads message
   content, members, or presence. (Confirmed in `discord_bot.py`: `intents =
   discord.Intents.default()`.)
4. Recommended: turn **Public Bot** OFF so only you can invite it.

### B. Bot permissions (minimal)
Slash commands need almost nothing. In the **Bot** page and the invite scope:
- **Send Messages** (to reply; replies are ephemeral but still need this).
- That's it. No Manage Server, no Message Content, no admin.
- Permissions integer for just Send Messages = **2048**.

### C. OAuth2 invite URL
OAuth2 → **URL Generator**:
- **Scopes:** check `bot` **and** `applications.commands` (the second is what
  lets slash commands register).
- **Bot Permissions:** check **Send Messages** (2048).
- Copy the generated URL, open it, pick your **dev server**, Authorize.

### D. Collect the three IDs
- **Bot token:** Developer Portal → **Bot** → **Reset Token** → copy once
  (shown only once; treat it like a password).
- **Guild/server ID:** Discord app → User Settings → **Advanced** → enable
  **Developer Mode** → right-click your dev server icon → **Copy Server ID**.
- **Your operator user ID:** right-click your own name → **Copy User ID**.

### E. Create `config.yaml` (no secrets in it)
```bash
cp ops/discord_outreach_bot/config.example.yaml ops/discord_outreach_bot/config.yaml
```
Edit `config.yaml` and set:
```yaml
discord:
  bot_token_env: DISCORD_BOT_TOKEN   # token comes from the ENV VAR, not this file
  guild_id: <your dev server ID>     # instant slash-command sync
  allowed_operator_ids:
    - <your user ID>                 # empty list = fail-closed = blocks everyone
```
The token is **never** written to `config.yaml` — only the env var *name* lives
here. `config.yaml` is operator-local; do not commit it.

### F. Set the token safely
```bash
export DISCORD_BOT_TOKEN='paste-token-here'   # current shell only; not committed
```
Do not hard-code it in any file and do not paste it into chat. If it ever leaks,
**Reset Token** in the portal immediately.

### G. Install discord.py (only after you approve installing it)
```bash
PY=/Users/taewookang/.pyenv/shims/python3
$PY -m pip install 'discord.py>=2.3'
```
`pyyaml` is already present (used to read `config.yaml`).

### H. Run the bot locally
```bash
PY=/Users/taewookang/.pyenv/shims/python3
$PY ops/discord_outreach_bot/discord_bot.py
```
On success the console prints `outreach bot ready as <name> (guild commands
synced)`. With `guild_id` set, the seven slash commands appear in your dev
server within seconds. Stop with Ctrl-C.

### I. Smoke-test sequence (run in the dev server, in order)

| # | Command | Expected |
|---|---------|----------|
| 1 | `/outreach_list` | 7 targets; S.NATURE shows `🟢 READY_TO_SCHEDULE … → mkt@snature.kr; follow-up TBD` |
| 2 | `/outreach_status slug:snature_aqua_squalane_cream_v1` | state `READY_TO_SCHEDULE`, corpus 488, angle H1, recipient mkt@snature.kr, next = `outreach:mark_sent` |
| 3 | `/outreach_next slug:snature_aqua_squalane_cream_v1` | "at 🟢 `READY_TO_SCHEDULE`", next `outreach:mark_sent` (records-only) |
| 4 | `/outreach_prompt slug:snature_aqua_squalane_cream_v1` | **prompt is ~2527 chars (> 2000 Discord cap), so the reply is a saved path** `…/generated_prompts/snature_aqua_squalane_cream_v1__auto.md`, not an inline block. This file write is to `generated_prompts/`, **not** a packet folder. |
| 5 | `/outreach_followups today:2026-06-08` | 메노킨 ⚠ OVERDUE by 3d; 휩드 ● DUE TODAY → business@whipped.co.kr. **(Since 2026-06-01 S.NATURE is recorded `SENT` with follow_up_due 2026-06-08, so it now also appears as ● DUE TODAY → mkt@snature.kr.)** |
| 6 | `/outreach_validate slug:snature_aqua_squalane_cream_v1` | all 6 required files ✅, `RESULT: ✅ OK` |
| 7 | `/outreach_approve slug:snature_aqua_squalane_cream_v1 stage:follow_up mode:prompt_only notes:"dev smoke only"` | **Appends ONE record to `approvals.log.jsonl` and nothing else.** Reply confirms target/state/stage/`prompt_hash`. It does **NOT** send a follow-up, **NOT** change `status.json`/`send_log.md`, **NOT** run Claude Code. The reply explicitly says the gate is not bypassed. |

> Step 7 note: because S.NATURE is at `READY_TO_SCHEDULE` (not `SCHEDULED`), the
> generated prompt for `stage:follow_up` includes a "requested stage operates
> from SCHEDULED" confirmation note — expected for a dev smoke. The log record
> still writes correctly with `current_state: READY_TO_SCHEDULE`,
> `approved_stage: follow_up`.

After the smoke test, inspect the log read-only:
```bash
$PY -c "import sys; sys.path.insert(0,'ops/discord_outreach_bot'); import approval_log as a; print(a.read_records())"
```

### J. If the slash commands do not appear
- Confirm the invite used **both** `bot` and `applications.commands` scopes
  (re-invite via the OAuth2 URL if not).
- Confirm `guild_id` in `config.yaml` matches the server you're testing in
  (global sync without `guild_id` can take ~1 hour to propagate).
- Confirm the console printed `ready … (guild commands synced)` with no
  traceback; if the token is wrong you'll see a login failure instead.
- Confirm you're on the operator allowlist — an empty `allowed_operator_ids`
  is fail-closed and replies "You are not on the operator allowlist."
- Try fully quitting and reopening the Discord client to refresh the command
  list.

## Next steps for v0.3

1. **Install + connect** — `pip install 'discord.py>=2.3'`, set
   `DISCORD_BOT_TOKEN` and the operator allowlist, run `discord_bot.py`, and do
   one real round-trip in a private dev guild.
2. **Approve/Hold buttons** — attach buttons to a posted 🔴 prompt so approval is
   one click instead of a typed `/outreach_approve`.
3. **Optional local runner** — an `execution_mode: local_run` path that, on an
   approval record, runs the generated prompt as a Claude Code turn on the Mac —
   still re-checking the matching record and honoring every guardrail.
4. **Follow-up reminders** — a scheduled task that posts overdue/due-today
   follow-ups to the operator channel (read-only; `follow_up` stays a 🔴 gate).
