package com.sellerops.organization;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Entity
@Table(name = "organizations")
public class Organization extends BaseEntity {

    @Column(nullable = false)
    private String name;
}
