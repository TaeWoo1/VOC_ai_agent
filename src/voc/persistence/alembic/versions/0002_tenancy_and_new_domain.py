"""tenancy + new domain tables

Revision ID: 0002_tenancy_and_new_domain
Revises: 0001_baseline
Create Date: 2026-04-19

PR 3 Phase 3A migration.  Purely additive: 13 new tables for the v1 SaaS
domain model (tenancy, listings, reviews, operational tables) plus seed
rows for the default Account and default Workspace using locked UUIDs from
``src.voc.persistence.seed_ids``.

Implementation notes
--------------------
* Style: Alembic-idiomatic ``op.create_table(...)`` with SA Column objects.
  Both migration and the corresponding models go through the same SA
  rendering path, which keeps the PR 2 autogenerate-empty test green.
* PK columns are declared ``primary_key=True, nullable=True`` to match
  SQLite's permissive TEXT-PRIMARY-KEY behavior — same baseline-fidelity
  decision as PR 2's models.
* JSON-shaped columns are stored as ``Text``, never ``JSON``.  Repository
  code does ``json.loads/dumps`` explicitly.
* ``users`` and ``workspace_members`` are created but **scaffolded
  inactive** in v1: no application code is allowed to import their
  models or repositories.  A static test in PR 3.C enforces this.
* ``reviews`` table includes ``content_fingerprint`` with a NON-UNIQUE
  composite index for lookups; the UNIQUE constraint is intentionally
  deferred to PR 6, when dual-write and synthesized listing_id behavior
  are introduced.
* Foreign keys are declared but SQLite does not enforce them by default
  (requires ``PRAGMA foreign_keys=ON`` per connection).  The declarations
  serve documentation, SA model relationships, and Postgres later (M5+).

Downgrade
---------
``downgrade()`` drops all 13 tables in reverse-creation order.  Seed rows
go with their tables; no explicit DELETE needed.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from src.voc.persistence.seed_ids import DEFAULT_ACCOUNT_ID, DEFAULT_WORKSPACE_ID

# revision identifiers, used by Alembic.
revision: str = "0002_tenancy_and_new_domain"
down_revision: Union[str, None] = "0001_baseline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Deterministic timestamp for seed rows so the migration is byte-identical
# across runs.  Values are arbitrary; using the M1-PR3 commit window date.
_SEED_AT = "2026-04-19T00:00:00+00:00"


def upgrade() -> None:
    # ── 1. accounts (tenancy root, no FKs) ─────────────────────────────
    op.create_table(
        "accounts",
        sa.Column("account_id", sa.Text(), primary_key=True, nullable=True),
        sa.Column("name",       sa.Text(), nullable=False),
        sa.Column("plan",       sa.Text(), nullable=False, server_default=sa.text("'free'")),
        sa.Column("created_at", sa.Text(), nullable=False),
    )

    # ── 2. workspaces (FK accounts CASCADE) ────────────────────────────
    op.create_table(
        "workspaces",
        sa.Column("workspace_id", sa.Text(), primary_key=True, nullable=True),
        sa.Column("account_id",   sa.Text(), nullable=False),
        sa.Column("name",         sa.Text(), nullable=False),
        sa.Column("created_at",   sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["account_id"], ["accounts.account_id"],
            name="fk_workspaces_account_id",
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_workspaces_account_id", "workspaces", ["account_id"])

    # ── 3. api_keys (FK workspaces CASCADE) ────────────────────────────
    op.create_table(
        "api_keys",
        sa.Column("api_key_id",   sa.Text(), primary_key=True, nullable=True),
        sa.Column("workspace_id", sa.Text(), nullable=False),
        sa.Column("key_hash",     sa.Text(), nullable=False),
        sa.Column("key_salt",     sa.Text(), nullable=False),
        sa.Column("name",         sa.Text(), nullable=False),
        sa.Column("status",       sa.Text(), nullable=False, server_default=sa.text("'active'")),
        sa.Column("created_at",   sa.Text(), nullable=False),
        sa.Column("last_used_at", sa.Text()),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspaces.workspace_id"],
            name="fk_api_keys_workspace_id",
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_api_keys_workspace_id", "api_keys", ["workspace_id"])
    op.create_index("ix_api_keys_key_hash",     "api_keys", ["key_hash"])

    # ── 4. users (SCAFFOLDED INACTIVE, no FKs) ─────────────────────────
    op.create_table(
        "users",
        sa.Column("user_id",       sa.Text(), primary_key=True, nullable=True),
        sa.Column("email",         sa.Text(), nullable=False),
        sa.Column("display_name",  sa.Text()),
        sa.Column("password_hash", sa.Text()),
        sa.Column("status",        sa.Text(), nullable=False, server_default=sa.text("'active'")),
        sa.Column("created_at",    sa.Text(), nullable=False),
        sa.Column("last_login_at", sa.Text()),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )

    # ── 5. workspace_members (SCAFFOLDED INACTIVE; FK workspaces CASCADE,
    #       FK users RESTRICT) ─────────────────────────────────────────
    op.create_table(
        "workspace_members",
        sa.Column("member_id",    sa.Text(), primary_key=True, nullable=True),
        sa.Column("workspace_id", sa.Text(), nullable=False),
        sa.Column("user_id",      sa.Text(), nullable=False),
        sa.Column("role",         sa.Text(), nullable=False),
        sa.Column("invited_at",   sa.Text()),
        sa.Column("joined_at",    sa.Text()),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspaces.workspace_id"],
            name="fk_workspace_members_workspace_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.user_id"],
            name="fk_workspace_members_user_id",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("workspace_id", "user_id", name="uq_workspace_members_ws_user"),
    )

    # ── 6. listings (FK workspaces RESTRICT) ───────────────────────────
    op.create_table(
        "listings",
        sa.Column("listing_id",    sa.Text(), primary_key=True, nullable=True),
        sa.Column("workspace_id",  sa.Text(), nullable=False),
        sa.Column("external_id",   sa.Text()),
        sa.Column("external_url",  sa.Text()),
        sa.Column("kind",          sa.Text(), nullable=False),
        sa.Column("display_name",  sa.Text(), nullable=False),
        sa.Column("metadata_json", sa.Text(), server_default=sa.text("'{}'")),
        sa.Column("created_at",    sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspaces.workspace_id"],
            name="fk_listings_workspace_id",
            ondelete="RESTRICT",
        ),
    )
    op.create_index("ix_listings_workspace_id", "listings", ["workspace_id"])
    op.create_index(
        "ix_listings_workspace_external", "listings", ["workspace_id", "external_id"]
    )

    # ── 7. reviews (FK accounts/workspaces/listings RESTRICT;
    #       channel_connection_id is plain TEXT until PR 4 adds the FK) ──
    op.create_table(
        "reviews",
        sa.Column("review_id",             sa.Text(), primary_key=True, nullable=True),
        sa.Column("account_id",            sa.Text(), nullable=False),
        sa.Column("workspace_id",          sa.Text(), nullable=False),
        sa.Column("listing_id",            sa.Text(), nullable=False),
        sa.Column("channel_connection_id", sa.Text()),
        sa.Column("source_channel",        sa.Text(), nullable=False),
        sa.Column("source_external_id",    sa.Text()),
        sa.Column("source_url",            sa.Text()),
        sa.Column("text",                  sa.Text(), nullable=False),
        sa.Column("rating_normalized",     sa.Float()),
        sa.Column("rating_raw",            sa.Float()),
        sa.Column("language",              sa.Text(), nullable=False),
        sa.Column("author_handle_hash",    sa.Text()),
        sa.Column("posted_at",             sa.Text()),
        sa.Column("collected_at",          sa.Text(), nullable=False),
        sa.Column("ingested_at",           sa.Text(), nullable=False),
        sa.Column("content_fingerprint",   sa.Text(), nullable=False),
        sa.Column("is_duplicate",          sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("duplicate_of",          sa.Text()),
        sa.Column("owner_reply_json",      sa.Text()),
        sa.Column("metadata_json",         sa.Text(), server_default=sa.text("'{}'")),
        sa.ForeignKeyConstraint(
            ["account_id"], ["accounts.account_id"],
            name="fk_reviews_account_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspaces.workspace_id"],
            name="fk_reviews_workspace_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["listing_id"], ["listings.listing_id"],
            name="fk_reviews_listing_id",
            ondelete="RESTRICT",
        ),
    )
    # NON-UNIQUE composite index for the cross-channel dedup lookup path.
    # The UNIQUE constraint on this triple is INTENTIONALLY DEFERRED to
    # PR 6 — see migration docstring and the PR 3 plan for rationale.
    op.create_index(
        "ix_reviews_workspace_listing_fingerprint",
        "reviews",
        ["workspace_id", "listing_id", "content_fingerprint"],
    )
    op.create_index(
        "ix_reviews_workspace_posted_at",
        "reviews",
        ["workspace_id", "posted_at"],
    )
    op.create_index(
        "ix_reviews_workspace_listing_posted_at",
        "reviews",
        ["workspace_id", "listing_id", "posted_at"],
    )
    op.create_index(
        "ix_reviews_workspace_connection",
        "reviews",
        ["workspace_id", "channel_connection_id"],
    )

    # ── 8. ingestion_attempts (FK sync_jobs CASCADE) ───────────────────
    op.create_table(
        "ingestion_attempts",
        sa.Column("attempt_id",        sa.Text(), primary_key=True, nullable=True),
        sa.Column("job_id",            sa.Text(), nullable=False),
        sa.Column("connection_id",     sa.Text()),
        sa.Column("strategy_id",       sa.Text(), nullable=False),
        sa.Column("attempt_index",     sa.Integer(), nullable=False),
        sa.Column("status",            sa.Text(), nullable=False),
        sa.Column("outcome_code",      sa.Text(), nullable=False),
        sa.Column("started_at",        sa.Text(), nullable=False),
        sa.Column("finished_at",       sa.Text()),
        sa.Column("reviews_collected", sa.Integer(), server_default=sa.text("0")),
        sa.Column("reviews_persisted", sa.Integer(), server_default=sa.text("0")),
        sa.Column("error_summary",     sa.Text()),
        sa.Column("error_chain_json",  sa.Text()),
        sa.Column("metadata_json",     sa.Text(), server_default=sa.text("'{}'")),
        sa.ForeignKeyConstraint(
            ["job_id"], ["sync_jobs.job_id"],
            name="fk_ingestion_attempts_job_id",
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_ingestion_attempts_job_id",        "ingestion_attempts", ["job_id"])
    op.create_index("ix_ingestion_attempts_connection_id", "ingestion_attempts", ["connection_id"])
    op.create_index("ix_ingestion_attempts_started_at",    "ingestion_attempts", ["started_at"])

    # ── 9. alerts (FK workspaces CASCADE; snapshot_id is plain TEXT) ────
    op.create_table(
        "alerts",
        sa.Column("alert_id",            sa.Text(), primary_key=True, nullable=True),
        sa.Column("workspace_id",        sa.Text(), nullable=False),
        sa.Column("monitored_entity_id", sa.Text()),
        sa.Column("snapshot_id",         sa.Text()),
        sa.Column("rule_id",             sa.Text(), nullable=False),
        sa.Column("severity",            sa.Text(), nullable=False, server_default=sa.text("'info'")),
        sa.Column("status",              sa.Text(), nullable=False, server_default=sa.text("'open'")),
        sa.Column("fired_at",            sa.Text(), nullable=False),
        sa.Column("acknowledged_at",     sa.Text()),
        sa.Column("payload_json",        sa.Text(), server_default=sa.text("'{}'")),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspaces.workspace_id"],
            name="fk_alerts_workspace_id",
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_alerts_workspace_id",     "alerts", ["workspace_id"])
    op.create_index("ix_alerts_workspace_status", "alerts", ["workspace_id", "status"])
    op.create_index("ix_alerts_fired_at",         "alerts", ["fired_at"])

    # ── 10. audit_log (append-only; FK accounts/workspaces RESTRICT) ────
    op.create_table(
        "audit_log",
        sa.Column("audit_id",     sa.Text(), primary_key=True, nullable=True),
        sa.Column("account_id",   sa.Text(), nullable=False),
        sa.Column("workspace_id", sa.Text()),
        sa.Column("actor_type",   sa.Text(), nullable=False),
        sa.Column("actor_id",     sa.Text(), nullable=False),
        sa.Column("action",       sa.Text(), nullable=False),
        sa.Column("target_type",  sa.Text()),
        sa.Column("target_id",    sa.Text()),
        sa.Column("before_json",  sa.Text()),
        sa.Column("after_json",   sa.Text()),
        sa.Column("occurred_at",  sa.Text(), nullable=False),
        sa.Column("source_ip",    sa.Text()),
        sa.ForeignKeyConstraint(
            ["account_id"], ["accounts.account_id"],
            name="fk_audit_log_account_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspaces.workspace_id"],
            name="fk_audit_log_workspace_id",
            ondelete="RESTRICT",
        ),
    )
    op.create_index("ix_audit_log_account_occurred",   "audit_log", ["account_id", "occurred_at"])
    op.create_index("ix_audit_log_workspace_occurred", "audit_log", ["workspace_id", "occurred_at"])

    # ── 11. secrets_pointers (no FKs — lookup-only) ────────────────────
    op.create_table(
        "secrets_pointers",
        sa.Column("secret_ref",      sa.Text(), primary_key=True, nullable=True),
        sa.Column("external_id",     sa.Text(), nullable=False),
        sa.Column("schema_version",  sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("connector_type",  sa.Text()),
        sa.Column("rotated_at",      sa.Text()),
        sa.Column("created_at",      sa.Text(), nullable=False),
    )
    op.create_index("ix_secrets_pointers_external_id", "secrets_pointers", ["external_id"])

    # ── 12. dead_letter (FK sync_jobs RESTRICT — preserve failure record) ─
    op.create_table(
        "dead_letter",
        sa.Column("dead_letter_id",   sa.Text(), primary_key=True, nullable=True),
        sa.Column("job_id",           sa.Text(), nullable=False),
        sa.Column("queue_name",       sa.Text(), nullable=False),
        sa.Column("payload_json",     sa.Text(), nullable=False),
        sa.Column("error_chain_json", sa.Text(), nullable=False),
        sa.Column("attempts",         sa.Integer(), nullable=False),
        sa.Column("moved_at",         sa.Text(), nullable=False),
        sa.Column("replayed_at",      sa.Text()),
        sa.ForeignKeyConstraint(
            ["job_id"], ["sync_jobs.job_id"],
            name="fk_dead_letter_job_id",
            ondelete="RESTRICT",
        ),
    )
    op.create_index("ix_dead_letter_job_id",   "dead_letter", ["job_id"])
    op.create_index("ix_dead_letter_moved_at", "dead_letter", ["moved_at"])

    # ── 13. indexing_runs (FK workspaces CASCADE) ──────────────────────
    op.create_table(
        "indexing_runs",
        sa.Column("indexing_run_id",   sa.Text(), primary_key=True, nullable=True),
        sa.Column("workspace_id",      sa.Text(), nullable=False),
        sa.Column("review_batch_size", sa.Integer(), nullable=False),
        sa.Column("status",            sa.Text(), nullable=False),
        sa.Column("started_at",        sa.Text(), nullable=False),
        sa.Column("finished_at",       sa.Text()),
        sa.Column("chunks_created",    sa.Integer(), server_default=sa.text("0")),
        sa.Column("error_summary",     sa.Text()),
        sa.Column("metadata_json",     sa.Text(), server_default=sa.text("'{}'")),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspaces.workspace_id"],
            name="fk_indexing_runs_workspace_id",
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_indexing_runs_workspace_id", "indexing_runs", ["workspace_id"])
    op.create_index("ix_indexing_runs_started_at",   "indexing_runs", ["started_at"])

    # ── Seed default Account + Workspace rows ──────────────────────────
    accounts_table = sa.table(
        "accounts",
        sa.column("account_id", sa.Text),
        sa.column("name",       sa.Text),
        sa.column("plan",       sa.Text),
        sa.column("created_at", sa.Text),
    )
    workspaces_table = sa.table(
        "workspaces",
        sa.column("workspace_id", sa.Text),
        sa.column("account_id",   sa.Text),
        sa.column("name",         sa.Text),
        sa.column("created_at",   sa.Text),
    )
    op.bulk_insert(
        accounts_table,
        [
            {
                "account_id": DEFAULT_ACCOUNT_ID,
                "name":       "Default Account",
                "plan":       "free",
                "created_at": _SEED_AT,
            }
        ],
    )
    op.bulk_insert(
        workspaces_table,
        [
            {
                "workspace_id": DEFAULT_WORKSPACE_ID,
                "account_id":   DEFAULT_ACCOUNT_ID,
                "name":         "Default Workspace",
                "created_at":   _SEED_AT,
            }
        ],
    )


def downgrade() -> None:
    # Reverse-creation order.  Indexes are dropped automatically with
    # their tables; explicit drops are not required.  Seed rows go with
    # their tables.
    op.drop_table("indexing_runs")
    op.drop_table("dead_letter")
    op.drop_table("secrets_pointers")
    op.drop_table("audit_log")
    op.drop_table("alerts")
    op.drop_table("ingestion_attempts")
    op.drop_table("reviews")
    op.drop_table("listings")
    op.drop_table("workspace_members")
    op.drop_table("users")
    op.drop_table("api_keys")
    op.drop_table("workspaces")
    op.drop_table("accounts")
