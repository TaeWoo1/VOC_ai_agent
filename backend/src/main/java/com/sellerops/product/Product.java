package com.sellerops.product;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Entity
@Table(name = "products")
public class Product extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(nullable = false)
    private String name;

    private String sku;

    @Column(nullable = false)
    private String status;
}
