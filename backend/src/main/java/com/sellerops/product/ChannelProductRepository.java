package com.sellerops.product;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ChannelProductRepository extends JpaRepository<ChannelProduct, UUID> {
}
