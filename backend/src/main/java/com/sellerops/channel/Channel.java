package com.sellerops.channel;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

/** Global catalog of supported commerce channels + collectable-data badges. */
@Getter
@Setter
@Entity
@Table(name = "channels")
public class Channel extends BaseEntity {

    @Column(nullable = false, unique = true)
    private String code;

    @Column(name = "name_ko", nullable = false)
    private String nameKo;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private ChannelStatus status;

    @Column(name = "supports_inquiry", nullable = false)
    private boolean supportsInquiry;

    @Column(name = "supports_review", nullable = false)
    private boolean supportsReview;

    @Column(name = "supports_order", nullable = false)
    private boolean supportsOrder;

    @Column(name = "supports_sales", nullable = false)
    private boolean supportsSales;

    @Column(name = "supports_product", nullable = false)
    private boolean supportsProduct;

    @Column(name = "sort_order", nullable = false)
    private int sortOrder;
}
