package com.sellerops.inquiry.goal;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.inquiry.authority.CapabilityId;
import com.sellerops.inquiry.authority.EntityField;
import java.util.EnumSet;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>Both over-read regressions, on one rule</b> (Inquiry v3.5 §8).
 *
 * <p>The brief set the bar: a resolver contract that passes {@code P01}/{@code C4} (a harmless over-read must not
 * discard an answerable goal) <b>and</b> {@code R:7a8136b2} (a genuinely missing required field must still be a gap),
 * while refusing "any readable field resolves it". Those three pull against each other, and the previous two
 * candidate semantics each failed one of them:
 *
 * <table><caption>priced on the recorded runs in WP-3.1 §2 and WP-3.2 §4</caption>
 *   <tr><th></th><th>P01 / C4</th><th>R:7a8136b2</th></tr>
 *   <tr><td>all-or-nothing <i>(shipped)</i></td><td><b>fails</b> — over-read is fatal</td><td>passes</td></tr>
 *   <tr><td>field-level</td><td>passes</td><td><b>fails</b> — a spare readable field hides the missing one</td></tr>
 *   <tr><td>required dimensions <i>(here)</i></td><td>passes</td><td>passes</td></tr>
 * </table>
 */
class EntityStateRequirementTest {

    private static final EntityStateRequirement ORDER = EntityStateRequirement.of(CapabilityId.ENTITY_ORDER);

    @Test
    @DisplayName("P01 / C4: a field the goal never needed cannot discard a goal the deployment can answer")
    void harmlessOverReadDoesNotBlock() {
        // Exactly the shipped shape: fulfilment readable, tracking not — no channel in this repository reads a
        // carrier number. Under all-or-nothing this was NOT_SUPPORTED and the goal was reported unanswerable.
        Set<EntityField> readable = EnumSet.of(EntityField.ORDER_FULFILLMENT);
        assertThat(ORDER.satisfiedBy(readable)).isTrue();
        assertThat(ORDER.unsatisfied(readable)).isEmpty();
        assertThat(ORDER.optional()).contains(EntityField.ORDER_TRACKING);
    }

    @Test
    @DisplayName("R:7a8136b2: a spare readable field does not stand in for the one that answers the question")
    void aReadableSpareDoesNotHideAMissingRequirement() {
        // Fulfilment is genuinely unreadable on that channel; payment and cancellation happen to be readable.
        Set<EntityField> readable = EnumSet.of(EntityField.ORDER_PAYMENT, EntityField.ORDER_CANCELLATION);
        assertThat(ORDER.satisfiedBy(readable)).as("field-level availability says yes here, and is wrong").isFalse();
        assertThat(ORDER.unsatisfied(readable)).singleElement()
                .isEqualTo(Set.of(EntityField.ORDER_FULFILLMENT));
    }

    @Test
    @DisplayName("'any readable field resolves it' is not the rule, for any non-empty subset")
    void anyFieldIsNeverEnough() {
        for (EntityField f : EntityField.values()) {
            if (f.capability() != CapabilityId.ENTITY_ORDER) {
                continue;
            }
            boolean ok = ORDER.satisfiedBy(EnumSet.of(f));
            assertThat(ok).as("%s alone", f).isEqualTo(f == EntityField.ORDER_FULFILLMENT);
        }
        assertThat(ORDER.satisfiedBy(Set.of())).isFalse();
    }

    @Test
    @DisplayName("a dimension is satisfied at whichever granularity is readable, and demands neither")
    void listingSaleStatusIsOneDimension() {
        EntityStateRequirement listing = EntityStateRequirement.of(CapabilityId.ENTITY_LISTING);
        assertThat(listing.satisfiedBy(EnumSet.of(EntityField.LISTING_OPTION_SALE_STATUS))).isTrue();
        assertThat(listing.satisfiedBy(EnumSet.of(EntityField.LISTING_SALE_STATUS))).isTrue();
        assertThat(listing.satisfiedBy(Set.of())).isFalse();
        assertThat(listing.requiredDimensions()).as("one dimension, two ways to satisfy it").hasSize(1);
    }

    @Test
    @DisplayName("every entity in the registry declares what answers a question about it")
    void everyEntityIsDeclared() {
        for (CapabilityId c : CapabilityId.values()) {
            if (c.authority() == com.sellerops.inquiry.authority.Authority.ENTITY_STATE) {
                assertThat(EntityStateRequirement.of(c)).as("%s", c).isNotNull();
                assertThat(EntityStateRequirement.of(c).readable())
                        .as("%s: every field of the entity is either required or optional", c)
                        .containsExactlyInAnyOrderElementsOf(
                                java.util.Arrays.stream(EntityField.values()).filter(f -> f.capability() == c).toList());
            }
        }
    }
}
