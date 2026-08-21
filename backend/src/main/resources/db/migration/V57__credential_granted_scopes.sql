-- Requesting a scope and holding it are different facts, and the product only ever had the first.
--
-- The second was discovered at call time, months later, as an insufficient_scope on a product read —
-- by which point the seller had long since finished consenting and the only remedy was to ask them
-- back. Cafe24 returns the granted scope list with every token, including every refresh; it was
-- parsed by nothing and stored nowhere.
--
-- Non-secret by nature: a scope list says what a connection is allowed to read, never what it read
-- or what it holds. It sits beside the encrypted payload rather than inside it precisely so a
-- troubleshooting surface can answer "does this connection have product permission?" without
-- decrypting anything.
--
-- Null means unknown, not empty. A credential stored before this column existed has a scope set
-- nobody recorded, and treating that as "no scopes" would report every pre-existing connection as
-- unable to do things it may do perfectly well.
alter table connector_credentials
    add column if not exists granted_scopes varchar(512);

comment on column connector_credentials.granted_scopes is
    'Comma-separated scopes the provider reported granting. NULL = never observed, not empty.';
