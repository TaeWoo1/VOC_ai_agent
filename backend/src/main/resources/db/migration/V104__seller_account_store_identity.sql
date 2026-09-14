-- Which store a seller account IS — kept apart from permission to call that channel's API.
--
-- These are two different facts and Coupang's credential form had them in one place. `vendor_id`
-- (업체코드) says WHICH STORE this account represents; `access_key`/`secret_key` say WE MAY CALL THE
-- API AS IT. Browser review acquisition needs only the first — it proves the screen the seller has
-- open belongs to this account and then reads it — and never calls Coupang at all. But the only form
-- carrying 업체코드 was the OpenAPI credential form, whose three fields are all required, so a seller
-- who wanted browser collection had to obtain API keys to tell us their store code.
--
-- The fix is not to relax that form. Faking a credential, accepting a dummy key, or making the API
-- fields optional would each leave a row that claims an API permission nobody has, and the features
-- that really use the API would then fail at call time instead of at input time. The fix is to stop
-- storing a non-secret on the credential's behalf: the store identity moves to the account, where it
-- describes the account.
--
-- NOT a secret, and deliberately not in the vault. The credential template has always declared this
-- field `secret = false`; it is one letter and eight digits, printed in WING's own chrome, and the
-- comparison the acquisition run makes is over a digest of it (`WingStoreIdentity`) precisely because
-- the digest is a comparison device rather than a concealment one. Putting a non-secret into the vault
-- to borrow its storage would make every reader treat it as one.
--
-- NO BACKFILL, and none is needed: the acquisition read prefers this column and falls back to the
-- credential's `vendor_id`, so every account that already connected keeps working unchanged and no
-- ciphertext has to be opened by a migration. The OpenAPI callers (`CoupangApiConnector`,
-- `CoupangChannelReplyAdapter`) are untouched — they hold access/secret anyway and read the vendor id
-- beside them, which is the right place for a caller that is about to authenticate as that vendor.
--
-- Channel-generic on purpose, wired for exactly one channel today. NAVER and Cafe24 have their own
-- store identifiers (a store id, a mall id); nothing here reads them and this migration does not
-- invent a place for them to mean something.
alter table seller_accounts add column store_identity varchar(64);

comment on column seller_accounts.store_identity is
    'Channel-native identifier of the store this account represents (Coupang 업체코드). Not a secret, not a credential: it answers "which store", never "may we call the API".';
