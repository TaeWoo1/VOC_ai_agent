package com.sellerops.product;

import com.sellerops.common.BaseEntity;
import com.sellerops.common.DataOrigin;
import com.sellerops.common.RealDataOnly;
import jakarta.persistence.Column;
import jakarta.persistence.Enumerated;
import jakarta.persistence.EnumType;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.Filter;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Entity
@Table(name = "products")
@Filter(name = RealDataOnly.NAME, condition = RealDataOnly.CONDITION)
public class Product extends BaseEntity {
    /**
     * Inherited from the evidence behind this row. A derived listing assembled entirely from seeded
     * rows is a claim about where the seller sells that nothing real supports — and Product Knowledge
     * states it to the Agent as fact, so it must not survive the filter its sources did not.
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "data_origin", nullable = false)
    private DataOrigin dataOrigin = DataOrigin.REAL;

    public DataOrigin getDataOrigin() {
        return dataOrigin;
    }

    public void setDataOrigin(DataOrigin dataOrigin) {
        this.dataOrigin = dataOrigin;
    }


    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(nullable = false)
    private String name;

    private String sku;

    @Column(nullable = false)
    private String status;
}
