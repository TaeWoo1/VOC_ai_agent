package com.sellerops.usage;

import java.time.LocalDate;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Reads and writes the one fact in {@link HomeOpenDay}. */
public interface HomeOpenDayRepository extends JpaRepository<HomeOpenDay, HomeOpenDay.Key> {

    boolean existsByOrgIdAndOpenedOn(UUID orgId, LocalDate openedOn);

    /** The pilot number: how many distinct days this organisation came back. */
    long countByOrgId(UUID orgId);
}
