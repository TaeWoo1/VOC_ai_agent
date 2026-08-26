-- Organization Answer Style v1 — how this company words a reply, once, for the whole org.
--
-- One row per org, and no generic preference framework. A key/value settings table would have made
-- this cheap to extend and impossible to constrain: every field below has a closed vocabulary or a
-- bounded length, and none of that survives a `settings(key text, value text)` shape.
--
-- Absence is the design, not a gap. An org with no row answers exactly as SellerOps does today
-- (AnswerStyleProfile.defaults()), so this migration backfills nothing and creates nothing for
-- existing companies. A row appears the first time someone saves the settings screen.
--
-- The two phrase lists are stored one phrase per line in a text column, and that is a DECLARED
-- representation rather than an encoding: a phrase may not contain a newline (rejected at write
-- time), the lists are capped at 5 and 10 entries, nothing queries inside them, and no meaning is
-- recovered from the prose by pattern matching. The list is a list; the column just holds it.
create table organization_answer_style (
    org_id             uuid primary key references organizations (id),

    -- Closed vocabularies. Stored as text (like every other enum in this schema) so a new value is
    -- a code change, not a migration; the service refuses anything outside the enum.
    tone               text        not null,
    length_preference  text        not null,
    emoji_policy       text        not null,

    -- The seller's own words. Optional, single-line, and treated as DATA everywhere downstream:
    -- they are never concatenated into the fixed rule section of a prompt.
    greeting           text,
    closing            text,
    customer_address   text,
    required_phrases   text,
    forbidden_phrases  text,

    -- The one sentence a seller pre-approves for "we do not know yet". Used verbatim or not at all;
    -- no model ever rewrites it, which is the whole point of it being here rather than generated.
    unknown_fallback   text,

    -- Identity of the wording that produced a draft. Bumped on every save and stamped into the
    -- draft's model_version, so a version sent last month can be read back against the style it was
    -- written under without storing a prompt snapshot.
    version            integer     not null default 1,
    updated_at         timestamptz not null,
    updated_by         uuid,

    created_at         timestamptz not null default now()
);
