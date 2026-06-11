-- One schedule per (org, seller account, data type): the control API's
-- read-then-insert upsert must not be able to duplicate rows under concurrent
-- PUTs. Additive only; fresh installs have no violating data.
create unique index if not exists uq_sync_schedules_account_data_type
    on sync_schedules (org_id, seller_account_id, data_type);
