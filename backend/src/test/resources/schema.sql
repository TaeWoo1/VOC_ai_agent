-- Test-only DDL for objects the entity mapping cannot express, run AFTER Hibernate builds the H2
-- schema from the entities (spring.jpa.defer-datasource-initialization=true).
--
-- The shared reply-work event sequence. In production Flyway V26 creates it; under test Flyway is
-- disabled and the schema comes from entities, but a plain @Column seq is not a generated identity,
-- so Hibernate never emits the sequence. This creates the same object for H2 (PostgreSQL mode) so the
-- dismissal/restore services' nextval('reply_work_event_seq') resolves. IF NOT EXISTS keeps it
-- idempotent across shared in-memory contexts.
create sequence if not exists reply_work_event_seq;
