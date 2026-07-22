# M6-C Step 1 — Claude Code CLI capability discovery

**Status:** discovery only. No adapter implemented. No agent task run.
**Branch:** `feat/discord-outreach-bot-m6c-claude-cli-discovery`
**Date:** 2026-06-03

This documents how the local Claude Code CLI can be invoked **safely and
non-interactively** for the future `claude_code_local` adapter (M6-C). It is the
prerequisite "record findings before implementing" step. **No prompt was passed,
no session was started, no file was edited, no Anthropic API was called, and no
`ANTHROPIC_API_KEY` was set or required.**

## Exact commands run (read-only, help/version only)

```
command -v claude || true
claude --version || true
claude --help
claude auth --help
```

That is the complete set. No subcommand other than `--help` was executed; in
particular `claude auth status` was **not** run (it performs a live auth check,
which is out of scope for a help-only discovery step) and no prompt/session
command was run.

## Raw findings (short excerpts)

- `command -v claude` → `/opt/homebrew/bin/claude`
- `claude --version` → `2.1.160 (Claude Code)`
- `claude --help` (Usage line):
  > `Usage: claude [options] [command] [prompt]`
  > `Claude Code - starts an interactive session by default, use -p/--print for non-interactive output`
- Relevant option excerpts:
  - `-p, --print` — "Print response and exit (useful for pipes). … workspace trust dialog is skipped when Claude is run in non-interactive mode (via -p, or when stdout is not a TTY)…"
  - `--permission-mode <mode>` — choices: `acceptEdits, auto, bypassPermissions, default, dontAsk, plan`
  - `--output-format <format>` — `text` (default), `json` (single result), `stream-json` (only with `--print`)
  - `--json-schema <schema>` — JSON Schema for structured output validation
  - `--input-format <format>` — `text` (default) / `stream-json` (only with `--print`)
  - `--add-dir <directories...>` — "Additional directories to allow tool access to"
  - `-w, --worktree [name]` — "Create a new git worktree for this session"
  - `--tools <tools...>` — `""` disables all tools, `"default"` all, or names e.g. `"Bash,Edit,Read"`
  - `--allowedTools` / `--disallowedTools <tools...>` — allow/deny tool patterns, e.g. `"Bash(git *) Edit"`
  - `--disable-slash-commands` — disable all skills
  - `--no-session-persistence` — sessions not saved/resumable (only with `--print`)
  - `--max-budget-usd <amount>` — spend cap (only with `--print`)
  - `--model <model>` — alias (`sonnet`/`opus`) or full id (`claude-opus-4-8`)
  - `--dangerously-skip-permissions` / `--allow-dangerously-skip-permissions` — bypass all permission checks (we will NOT use these)
  - `--bare` — "Anthropic auth is **strictly ANTHROPIC_API_KEY** or apiKeyHelper … (OAuth and keychain are never read)" → we must **avoid `--bare`** to keep using the no-API-key subscription session
- `claude auth --help` → subcommands `login`, `logout`, `status`. (Not executed beyond help.)

## Summarized capability findings

| Question | Finding |
|---|---|
| `claude` command exists? | **Yes** — `/opt/homebrew/bin/claude` |
| Version | **2.1.160 (Claude Code)** |
| Non-interactive / one-shot / print mode? | **Yes** — `-p, --print` (default is interactive) |
| Prompt via stdin? | **Yes** — print mode reads piped stdin; `--input-format text` (default) |
| Prompt via file? | **No first-class user-prompt-file flag.** `--file` is for downloading file *resources*, not the prompt. (System prompt has `--system-prompt`; `--bare` references `--system-prompt-file`/`--append-system-prompt-file`, but those are *system* prompts.) → read the prompt file in Python and pipe via stdin. |
| Prompt as argument? | **Yes** — trailing positional `[prompt]` |
| Working dir / allowed dir / permission mode? | **Yes** — process `cwd` (set via subprocess, no `--cwd` flag), `--add-dir` to scope tool access, `--permission-mode` (incl. `plan`) |
| Output-format / JSON? | **Yes** — `--output-format json` / `stream-json` (with `--print`); `--json-schema` for structured output |
| Read-only / plan mode? | **Yes** — `--permission-mode plan` (no edits) → ideal for `dry_run` |
| Timeout / sandbox / permission flags? | **Timeout: NO CLI flag** (enforce in Python via process-group kill). **Permissions: yes** — `--permission-mode`, `--tools`, `--allowedTools`/`--disallowedTools`, `--disable-slash-commands`. **Sandbox-bypass exists** (`--dangerously-skip-permissions`) but we will NOT use it. |
| Exit-code behavior documented? | **No** — not in help. Must be verified empirically (carefully) in M6-C. |
| Flags useful for the local adapter? | `-p/--print`, `--output-format json`, `--permission-mode plan|acceptEdits`, `--add-dir`, `-w/--worktree`, `--tools`/`--allowedTools`/`--disallowedTools`, `--no-session-persistence`, `--max-budget-usd`, `--model`, `--disable-slash-commands`, `--strict-mcp-config`. Avoid `--bare` and `--dangerously-skip-permissions`. |

## Recommended invocation strategy for `claude_code_local` (M6-C)

Process model (all enforced by Python, per the locked design):
- **No `shell=True`**; explicit `argv` list; `start_new_session=True` so the timeout can kill the whole process group (CLI has no timeout flag).
- **cwd** = a per-run git worktree under `.agent_worktrees/<run_id>` (locked decision). Either let Python create it (`git worktree add`) for full control of cleanup + diff, or use the CLI's `-w/--worktree`; **recommend Python-managed** so we own the lifecycle and `changed_files` diff.
- **Auth** = the logged-in subscription/OAuth session. **Do NOT pass `--bare`** (it would force `ANTHROPIC_API_KEY`). Do not set `ANTHROPIC_API_KEY`.
- **Prompt** = read the generated prompt artifact in Python and pipe via **stdin** (avoids argv length/escaping); `--input-format text`.

Proposed command shapes (to be validated empirically in M6-C):
- **dry_run (plan mode, zero edits):**
  `claude -p --permission-mode plan --output-format json --add-dir <worktree> --tools "Read,Grep,Glob" --no-session-persistence --disable-slash-commands` (prompt on stdin), `cwd=<worktree>`, Python timeout.
- **run (bounded_edit):**
  `claude -p --permission-mode acceptEdits --output-format json --add-dir <worktree> --disallowedTools "Bash(git push:*) Bash(git commit:*) Bash(rm:*)" --no-session-persistence --disable-slash-commands` (prompt on stdin), `cwd=<worktree>`, Python timeout.
- Capture stdout/stderr to `agent_runs/<run_id>/`; parse `--output-format json`; compute `changed_files` from `git -C <worktree> status --porcelain` / `git diff`; then run `agent_run_validator.validate_post_run` (out-of-scope edits → `blocked`).
- Optional defense: `--max-budget-usd` cap, `--model` pin, `--strict-mcp-config` / `--mcp-config ""` to avoid unexpected MCP servers.

`is_available()` (M6-C): `shutil.which("claude")` present **and** an authenticated session — the auth check should use `claude auth status` (a gated, authorized step, not run during this discovery). It must remain cheap and must not start a session.

## Unknowns / risks (verify carefully in M6-C, still gated)

- **Exit-code semantics** undocumented — must verify what `claude -p` returns on success / model error / refusal / interrupted.
- **`--output-format json` schema** — confirm which fields are present (result text, cost, changed files, stop reason) before relying on them.
- **`--permission-mode plan` guarantee** — confirm it truly performs zero writes for `dry_run`.
- **Headless behavior** — confirm `-p` with the subscription/OAuth session runs without any interactive prompt (help says the trust dialog is skipped in non-interactive mode; verify no other prompt).
- **Network + quota** — a real run makes a network call to Anthropic via the authenticated session and consumes subscription quota. This is the intended subscription path (not API-key billing), but it IS network activity and only happens during *authorized* M6-C runs, never in M6-B/this step.
- **Tool-restriction completeness** — confirm `--disallowedTools` patterns fully block `git push`/`commit`/network/`Bash` escapes; pair with the worktree + post-run validator as defense in depth.

## Explicit safety statement

No agent task was run. No prompt (project, repo, or task) was passed to Claude
Code. No session was started. No file was edited. No collection / email / PDF /
Instagram. No packet `status.json`/`send_log.md` mutation. No physical task
deletion. No Anthropic API call. No `ANTHROPIC_API_KEY` set or required. Only
`command -v`, `claude --version`, `claude --help`, and `claude auth --help` were
executed. `claude_code_local.py` was **not** modified — it remains a stub.
