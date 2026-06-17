package com.sellerops.sync;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SyncCursorRepository extends JpaRepository<SyncCursor, UUID> {

    Optional<SyncCursor> findByOrgIdAndSellerAccountIdAndDataTypeAndCursorKey(
            UUID orgId, UUID sellerAccountId, String dataType, String cursorKey);
}
