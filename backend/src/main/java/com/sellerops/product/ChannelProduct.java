package com.sellerops.product;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/** A product as listed on a specific channel. */
@Getter
@Setter
@Entity
@Table(name = "channel_products")
public class ChannelProduct extends BaseEntity {

    @Column(name = "product_id", nullable = false)
    private UUID productId;

    @Column(name = "channel_id", nullable = false)
    private UUID channelId;

    @Column(name = "external_product_id")
    private String externalProductId;

    @Column(name = "channel_price")
    private BigDecimal channelPrice;
}
