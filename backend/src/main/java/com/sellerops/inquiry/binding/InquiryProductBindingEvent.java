package com.sellerops.inquiry.binding;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One time a person said which product an inquiry is about.
 *
 * <p><b>Append-only, because a correction is not a deletion.</b> The binding column on the inquiry
 * holds only the latest answer; a draft generated last week was grounded in the library of whatever
 * product was bound THEN, and without this row there is no way to read that back. A seller who
 * rebinds an inquiry after sending a reply has produced exactly that situation.
 *
 * <p>Holds no inquiry content — a product id, who, and when. The reason a binding changed is not
 * modelled: it would be a free-text field nobody fills in, and the two product ids already say what
 * happened.
 */
@Getter
@Setter
@Entity
@Table(name = "inquiry_product_binding_events")
public class InquiryProductBindingEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "inquiry_id", nullable = false)
    private UUID inquiryId;

    /** What was bound before this event, if anything. Null on a first binding. */
    @Column(name = "previous_product_id")
    private UUID previousProductId;

    /** How the previous binding had been decided. Null when there was none. */
    @Column(name = "previous_binding", length = 16)
    private String previousBinding;

    @Column(name = "product_id", nullable = false)
    private UUID productId;

    @Column(name = "binding", nullable = false, length = 16)
    private String binding;

    @Column(name = "actor_user_id")
    private UUID actorUserId;

    /**
     * The actor's display name at the time.
     *
     * <p>Denormalized on purpose, the same way a knowledge document's author is: provenance that
     * disappears when a teammate leaves the org is not provenance.
     */
    @Column(name = "actor_name", length = 200)
    private String actorName;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
