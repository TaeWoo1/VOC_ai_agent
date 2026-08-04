-- At most one API-mode seller account per (organization, channel).
--
-- An org's official-API connection to a channel is singular: the guided-connection wizard find-or-creates
-- exactly one API-mode row (is_file_upload = false) per (org, channel). This PARTIAL unique index is the
-- database backstop behind the PESSIMISTIC_WRITE channel-row lock that SellerAccountService.registerApiChannel
-- already holds — the lock serializes concurrent connection starts (the second caller re-reads and returns
-- the first's account), and this index guarantees at most one API-mode row survives even if the lock is bypassed.
--
-- SCOPED TO API MODE ONLY (WHERE is_file_upload = false). File-upload accounts are deliberately NOT covered:
-- ESM file-import (EsmFileImportAccountService) legitimately holds several file-upload rows on one channel —
-- one per marketplace seller identity — so a full (org, channel, is_file_upload) constraint would wrongly
-- forbid that. Same filtered-index pattern the V2 dedup indexes use.
--
-- FAIL CLOSED ON EXISTING DUPLICATES: creating a UNIQUE index scans the covered rows and ABORTS this migration
-- if two API-mode accounts already share (org_id, channel_id). It never silently de-duplicates — on a database
-- carrying such a duplicate the migration fails loudly (the DB reports the index name and the offending key),
-- so an operator resolves it explicitly before the schema advances.
create unique index uq_seller_accounts_api_org_channel
    on seller_accounts (org_id, channel_id)
    where is_file_upload = false;
