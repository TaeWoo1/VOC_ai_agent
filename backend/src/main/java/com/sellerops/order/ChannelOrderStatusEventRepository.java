package com.sellerops.order;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ChannelOrderStatusEventRepository extends JpaRepository<ChannelOrderStatusEvent, UUID> {

    // Scoped by org as well as the order id — the event table carries org_id, so a reader can never
    // reach another org's history even if it somehow held a foreign channel_order_id.
    List<ChannelOrderStatusEvent> findAllByOrgIdAndChannelOrderIdOrderByRecordedAtAsc(
            UUID orgId, UUID channelOrderId);

    long countByOrgIdAndChannelOrderId(UUID orgId, UUID channelOrderId);
}
