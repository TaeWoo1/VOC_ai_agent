package com.sellerops.selleraccount;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AccountSessionSlotRepository extends JpaRepository<AccountSessionSlot, UUID> {

    /** The single slot for a seller account, if one has been minted. */
    Optional<AccountSessionSlot> findBySellerAccountId(UUID sellerAccountId);

    /** Resolve by the opaque slot alone — the reverse direction the runtime never gets to use. */
    Optional<AccountSessionSlot> findByAccountSlot(String accountSlot);
}
