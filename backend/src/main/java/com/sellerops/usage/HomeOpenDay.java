package com.sellerops.usage;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import java.io.Serializable;
import java.time.LocalDate;
import java.util.Objects;
import java.util.UUID;

/**
 * One organisation, one Asia/Seoul day on which 홈 was opened. <b>Both columns are the key, and there
 * is no third column.</b> (Pilot Launch Readiness §2, product-owner decision 2026-09-13.)
 *
 * <p>This exists to answer exactly one pilot question — <i>does the seller come back</i> — and the
 * shape is the answer to the privacy question that comes with it. There is no user id, no session,
 * no address, no user agent, no referrer, no time of day, no path, and no word a seller or a customer
 * wrote. Not because a rule forbids adding them, but because a field that does not exist cannot be
 * filled in by a later change that nobody read closely. {@code HomeOpenDayShapeTest} pins the count.
 *
 * <p>Nine opens on a Tuesday are one row, so the table cannot describe a visit frequency or a session
 * length even if someone later wanted it to — it can only say which days an organisation came back.
 */
@Entity
@Table(name = "home_open_day")
@IdClass(HomeOpenDay.Key.class)
public class HomeOpenDay {

    @Id
    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    /** Asia/Seoul, decided by the server: a client-supplied date is a client-supplied fact. */
    @Id
    @Column(name = "opened_on", nullable = false)
    private LocalDate openedOn;

    protected HomeOpenDay() {
    }

    public HomeOpenDay(UUID orgId, LocalDate openedOn) {
        this.orgId = orgId;
        this.openedOn = openedOn;
    }

    public UUID getOrgId() {
        return orgId;
    }

    public LocalDate getOpenedOn() {
        return openedOn;
    }

    /** JPA's composite-key holder. It carries the same two values and nothing else. */
    public static class Key implements Serializable {
        private UUID orgId;
        private LocalDate openedOn;

        public Key() {
        }

        public Key(UUID orgId, LocalDate openedOn) {
            this.orgId = orgId;
            this.openedOn = openedOn;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof Key other)) return false;
            return Objects.equals(orgId, other.orgId) && Objects.equals(openedOn, other.openedOn);
        }

        @Override
        public int hashCode() {
            return Objects.hash(orgId, openedOn);
        }
    }
}
