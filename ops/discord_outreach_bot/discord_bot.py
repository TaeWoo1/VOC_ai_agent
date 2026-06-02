#!/usr/bin/env python3
"""Discord transport for the outreach operator bot (v0.2).

A THIN, read-only layer over the v0.1 core. Slash commands call the existing
read-only functions (via discord_formatting.py) and post compact replies.
The only write path is the append-only approvals log (approval_log.py).

Hard invariants (carried from v0.1, enforced here by simply not having the code
to break them):
  - No email send, no collection, no PDF render, no commit from Discord.
  - No mutation of any packet status.json / send_log.md.
  - No Claude Code execution from Discord.
  - /outreach_approve records operator INTENT only; it never runs the stage and
    never bypasses a 🔴 gate.

`discord.py` is an OPTIONAL dependency. This module imports cleanly without it
(so the rest of the bot and the tests don't need it); only run_bot() requires
it, and raises a clear install message if it's missing.

Run locally:
    pip install 'discord.py>=2.3'        # only if the operator approves it
    export DISCORD_BOT_TOKEN=...         # never hard-code the token
    python3 ops/discord_outreach_bot/discord_bot.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

import approval_log as _alog          # noqa: E402
import discord_formatting as _fmt      # noqa: E402
import orchestration_events as _oev     # noqa: E402
import prompt_builder as _pb           # noqa: E402
import status_reader as _sr            # noqa: E402
import task_discord_adapter as _tasks   # noqa: E402
import task_store as _tstore            # noqa: E402

try:  # discord.py is optional; the module must import without it.
    import discord
    from discord import app_commands
    HAS_DISCORD = True
except ImportError:  # pragma: no cover - exercised only where the dep is absent
    discord = None
    app_commands = None
    HAS_DISCORD = False

try:
    import yaml
    HAS_YAML = True
except ImportError:  # pragma: no cover
    yaml = None
    HAS_YAML = False

_INSTALL_HINT = (
    "discord.py is not installed. v0.2 ships the adapter code but does not "
    "install packages. To run the bot:\n"
    "  pip install 'discord.py>=2.3'\n"
    "  export DISCORD_BOT_TOKEN=...\n"
    "  python3 ops/discord_outreach_bot/discord_bot.py\n"
    "Until then, use the v0.1 CLI (cli.py) — same read-only functions."
)


# --- config ------------------------------------------------------------------
def load_config(config_path: Optional[Path] = None) -> dict:
    """Read config.yaml if present; return defaults otherwise. No secrets here."""
    defaults = {
        "targets_dir": None,
        "discord": {
            "bot_token_env": "DISCORD_BOT_TOKEN",
            "guild_id": None,
            "operator_channel_id": None,
            "allowed_operator_ids": [],
        },
        "approvals": {
            "log_path": None,  # None -> approval_log.default_log_path()
        },
        "tasks": {
            "store_path": None,  # None -> task_store.default_store_path()
        },
        "events": {
            "log_path": None,  # None -> orchestration_events.default_events_path()
        },
        "nl": {
            # The natural-language on_message handler is OFF by default: it needs
            # the privileged Message Content Intent. v0.2 needed no privileged
            # intents; set true (and enable the intent in the Developer Portal)
            # only when you want free-form messages routed to the orchestrator.
            "enabled": False,
        },
    }
    path = Path(config_path) if config_path else (
        Path(__file__).resolve().parent / "config.yaml")
    if path.exists() and HAS_YAML:
        loaded = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        for key, val in loaded.items():
            if isinstance(val, dict) and isinstance(defaults.get(key), dict):
                defaults[key].update(val)
            else:
                defaults[key] = val
    return defaults


def _targets_dir(config: dict):
    td = config.get("targets_dir")
    return Path(td) if td else None


def _log_path(config: dict) -> Optional[Path]:
    lp = (config.get("approvals") or {}).get("log_path")
    return Path(lp) if lp else None


def _store_path(config: dict) -> Path:
    sp = (config.get("tasks") or {}).get("store_path")
    return Path(sp) if sp else _tstore.default_store_path()


def _events_path(config: dict) -> Path:
    ep = (config.get("events") or {}).get("log_path")
    return Path(ep) if ep else _oev.default_events_path()


def _nl_enabled(config: dict) -> bool:
    return bool((config.get("nl") or {}).get("enabled"))


def _operator_channel_id(config: dict) -> Optional[int]:
    cid = (config.get("discord") or {}).get("operator_channel_id")
    return int(cid) if cid else None


def _nl_runtime(config: dict) -> tuple[bool, Optional[int], Optional[str]]:
    """Resolve the EFFECTIVE natural-language settings (fail-closed).

    Returns (nl_active, operator_channel_id, warning). If nl.enabled is true but
    no operator_channel_id is set, NL is DISABLED (nl_active=False) with a
    warning — slash commands are unaffected. The NL handler must only ever run
    in the configured private operator channel.
    """
    enabled = _nl_enabled(config)
    channel = _operator_channel_id(config)
    if enabled and channel is None:
        return (False, None,
                "nl.enabled=true but discord.operator_channel_id is null — "
                "NATURAL-LANGUAGE HANDLER DISABLED (fail-closed). Set "
                "discord.operator_channel_id to a numeric private channel ID to "
                "enable NL. Slash commands still work.")
    return (enabled, channel, None)


def _allowed(config: dict, user_id: int) -> bool:
    ids = (config.get("discord") or {}).get("allowed_operator_ids") or []
    if not ids:  # empty allowlist = block all (fail-closed)
        return False
    return user_id in {int(x) for x in ids}


# --- approval recording (transport-independent core) -------------------------
def record_approval(*, slug: str, stage: str, operator_discord_id: str,
                    operator_display_name: Optional[str], notes: str,
                    config: dict) -> dict:
    """Build the prompt (read-only), then append an approval record.

    Records INTENT ONLY — does not execute the stage. Returns the written
    record (or {"ok": False, ...} if the target/stage can't be resolved).
    """
    targets_dir = _targets_dir(config)
    t = _sr.get_target(slug, targets_dir)
    if not t:
        return {"ok": False, "message": f"No packet matching `{slug}`."}
    # Hash the prompt TEXT only — do not save it (no side-effect file writes).
    prompt = _pb.build_prompt(t, stage=stage)
    record = _alog.make_record(
        target_slug=t.slug,
        current_state=t.state,
        approved_stage=stage.replace("outreach:", ""),
        prompt=prompt,
        operator_discord_id=operator_discord_id,
        operator_display_name=operator_display_name,
        execution_mode="prompt_only",
        notes=notes,
        source="discord",
    )
    path = _alog.append_record(record, _log_path(config))
    return {"ok": True, "record": record, "log_path": str(path)}


def _format_approval_reply(result: dict) -> str:
    if not result.get("ok"):
        return result.get("message", "Could not record approval.")
    rec = result["record"]
    return (
        f"✅ Recorded operator approval (intent only — NOT executed).\n"
        f"target: `{rec['target_slug']}` @ `{rec['current_state']}`\n"
        f"stage: `{rec['approved_stage']}` · mode: `{rec['execution_mode']}`\n"
        f"hash: `{rec['prompt_hash']}`\n"
        f"logged: `{result['log_path']}`\n"
        f"⛔ This does NOT run the stage or bypass the 🔴 gate. "
        f"Run it in an authorized Claude Code turn."
    )


# --- Discord wiring (only built when discord.py is present) ------------------
def build_bot(config: dict):  # pragma: no cover - requires discord.py
    """Construct the discord.py client + slash command tree."""
    if not HAS_DISCORD:
        raise NotImplementedError(_INSTALL_HINT)

    intents = discord.Intents.default()
    nl_enabled, op_channel, nl_warning = _nl_runtime(config)
    if nl_warning:
        print(f"WARNING: {nl_warning}")
    if nl_enabled:
        # required to read free-form message text (privileged intent)
        intents.message_content = True
    client = discord.Client(intents=intents)
    tree = app_commands.CommandTree(client)
    guild_id = (config.get("discord") or {}).get("guild_id")
    guild_obj = discord.Object(id=int(guild_id)) if guild_id else None
    targets_dir = _targets_dir(config)
    store_path = _store_path(config)
    events_path = _events_path(config)

    async def _guard(interaction) -> bool:
        if not _allowed(config, interaction.user.id):
            await interaction.response.send_message(
                "You are not on the operator allowlist for this bot.",
                ephemeral=True)
            return False
        return True

    @tree.command(name="outreach_list", description="List all outreach targets")
    async def outreach_list(interaction):
        if not await _guard(interaction):
            return
        await interaction.response.send_message(
            _fmt.format_list(targets_dir), ephemeral=True)

    @tree.command(name="outreach_status", description="Compact status for one target")
    @app_commands.describe(slug="target slug")
    async def outreach_status(interaction, slug: str):
        if not await _guard(interaction):
            return
        await interaction.response.send_message(
            _fmt.format_status(slug, targets_dir), ephemeral=True)

    @tree.command(name="outreach_next", description="Recommended next action")
    @app_commands.describe(slug="target slug")
    async def outreach_next(interaction, slug: str):
        if not await _guard(interaction):
            return
        await interaction.response.send_message(
            _fmt.format_next(slug, targets_dir), ephemeral=True)

    @tree.command(name="outreach_prompt", description="Generate the next Claude prompt")
    @app_commands.describe(slug="target slug", stage="optional explicit stage")
    async def outreach_prompt(interaction, slug: str, stage: Optional[str] = None):
        if not await _guard(interaction):
            return
        d = _fmt.build_prompt_delivery(slug, stage=stage, targets_dir=targets_dir)
        await interaction.response.send_message(d["message"], ephemeral=True)

    @tree.command(name="outreach_followups", description="Due/overdue/upcoming follow-ups")
    @app_commands.describe(today="optional YYYY-MM-DD override")
    async def outreach_followups(interaction, today: Optional[str] = None):
        if not await _guard(interaction):
            return
        import datetime as _dt
        day = _dt.date.fromisoformat(today) if today else None
        await interaction.response.send_message(
            _fmt.format_followups(day, targets_dir), ephemeral=True)

    @tree.command(name="outreach_validate", description="Validate packet files for the state")
    @app_commands.describe(slug="target slug")
    async def outreach_validate(interaction, slug: str):
        if not await _guard(interaction):
            return
        await interaction.response.send_message(
            _fmt.format_validate(slug, targets_dir), ephemeral=True)

    @tree.command(name="outreach_approve",
                  description="Record operator approval INTENT (does not execute)")
    @app_commands.describe(slug="target slug", stage="outreach:* stage being authorized",
                           mode="prompt_only", notes="optional note")
    async def outreach_approve(interaction, slug: str, stage: str,
                               mode: str = "prompt_only", notes: str = ""):
        if not await _guard(interaction):
            return
        if mode != "prompt_only":
            await interaction.response.send_message(
                "v0.2 only records `prompt_only` approvals.", ephemeral=True)
            return
        result = record_approval(
            slug=slug, stage=stage,
            operator_discord_id=str(interaction.user.id),
            operator_display_name=getattr(interaction.user, "display_name", None),
            notes=notes, config=config)
        await interaction.response.send_message(
            _format_approval_reply(result), ephemeral=True)

    # --- v0.3 M2: orchestration task commands (propose-only) -----------------
    @tree.command(name="tasks", description="List orchestration tasks")
    @app_commands.describe(status="optional status filter (e.g. needs_approval)")
    async def tasks(interaction, status: Optional[str] = None):
        if not await _guard(interaction):
            return
        await interaction.response.send_message(
            _tasks.cmd_tasks(store_path, status=status), ephemeral=True)

    @tree.command(name="task_status", description="Show one task graph + blockers")
    @app_commands.describe(task_id="task id (parent or leaf)")
    async def task_status(interaction, task_id: str):
        if not await _guard(interaction):
            return
        await interaction.response.send_message(
            _tasks.cmd_task_status(task_id, store_path), ephemeral=True)

    @tree.command(name="task_create",
                  description="Create + advance a task graph (propose-only)")
    @app_commands.describe(workflow="outreach / instagram / ops", goal="what to do",
                           target_slug="optional target slug")
    async def task_create(interaction, workflow: str, goal: str,
                          target_slug: Optional[str] = None):
        if not await _guard(interaction):
            return
        out = _tasks.cmd_task_create(
            workflow=workflow, goal=goal, target_slug=target_slug,
            requested_by=str(interaction.user.id), source="slash",
            store_path=store_path, events_path=events_path, targets_dir=targets_dir)
        await interaction.response.send_message(out["reply"], ephemeral=True)

    @tree.command(name="task_approve",
                  description="Record approval INTENT for a task (does not execute)")
    @app_commands.describe(task_id="task id", notes="optional note")
    async def task_approve(interaction, task_id: str, notes: str = ""):
        if not await _guard(interaction):
            return
        reply = _tasks.cmd_task_approve(
            task_id=task_id, operator_discord_id=str(interaction.user.id),
            operator_display_name=getattr(interaction.user, "display_name", None),
            notes=notes, store_path=store_path, events_path=events_path,
            approvals_path=_log_path(config), targets_dir=targets_dir)
        await interaction.response.send_message(reply, ephemeral=True)

    @tree.command(name="task_cancel", description="Cancel a task (records-only)")
    @app_commands.describe(task_id="task id", reason="optional reason")
    async def task_cancel(interaction, task_id: str, reason: str = ""):
        if not await _guard(interaction):
            return
        await interaction.response.send_message(
            _tasks.cmd_task_cancel(task_id=task_id, reason=reason,
                                   store_path=store_path, events_path=events_path),
            ephemeral=True)

    @tree.command(name="agent_status", description="List registered orchestration agents")
    async def agent_status(interaction):
        if not await _guard(interaction):
            return
        await interaction.response.send_message(
            _tasks.cmd_agent_status(), ephemeral=True)

    @tree.command(name="task_set_candidate",
                  description="Attach a candidate to a shortlist-pick task (records-only)")
    @app_commands.describe(
        task_id="candidate_shortlist_pick task id", slug="lowercase a-z0-9_ slug",
        brand="brand", goods_no="goodsNo", product_name="product name",
        product_url="optional product URL", note="optional note")
    async def task_set_candidate(interaction, task_id: str, slug: str, brand: str,
                                 goods_no: str, product_name: str,
                                 product_url: Optional[str] = None,
                                 note: Optional[str] = None):
        if not await _guard(interaction):
            return
        await interaction.response.send_message(
            _tasks.cmd_set_candidate(
                task_id=task_id, slug=slug, brand=brand, goods_no=goods_no,
                product_name=product_name, product_url=product_url, note=note,
                store_path=store_path, events_path=events_path),
            ephemeral=True)

    if nl_enabled:
        @client.event
        async def on_message(message):
            if message.author.bot or message.author == client.user:
                return
            if op_channel and message.channel.id != op_channel:
                return
            if not _allowed(config, message.author.id):
                return
            if not (message.content or "").strip():
                return
            out = _tasks.handle_nl_message(
                message.content, operator_discord_id=str(message.author.id),
                store_path=store_path, events_path=events_path,
                targets_dir=targets_dir)
            await message.channel.send(out["reply"])

    async def _sync():
        if guild_obj:
            tree.copy_global_to(guild=guild_obj)
            await tree.sync(guild=guild_obj)
        else:
            await tree.sync()

    @client.event
    async def on_ready():
        await _sync()
        print(f"outreach bot ready as {client.user} "
              f"({'guild' if guild_obj else 'global'} commands synced; "
              f"NL handler {'ON' if nl_enabled else 'off'})")

    return client


def run_bot(config_path: Optional[Path] = None) -> None:
    """Entry point. Requires discord.py + DISCORD_BOT_TOKEN."""
    if not HAS_DISCORD:
        raise NotImplementedError(_INSTALL_HINT)
    config = load_config(config_path)
    token_env = (config.get("discord") or {}).get("bot_token_env", "DISCORD_BOT_TOKEN")
    token = os.environ.get(token_env)
    if not token:
        raise SystemExit(
            f"Set the bot token in env var {token_env} (do not hard-code it).")
    client = build_bot(config)
    client.run(token)


if __name__ == "__main__":  # pragma: no cover
    run_bot()
