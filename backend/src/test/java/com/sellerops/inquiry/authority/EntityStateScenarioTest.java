package com.sellerops.inquiry.authority;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.sellerops.inquiry.decision.DetailCapability;
import com.sellerops.product.SellingStatus;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The ENTITY_STATE resolver on every synthetic scenario ({@code entity-scenarios.jsonl}): positive controls that resolve,
 * and each way an order or a listing may NOT be stated — unbound, unreachable, stale, unobservable, unproven, unnamed.
 */
class EntityStateScenarioTest {

    static final Instant NOW = Instant.parse("2026-09-20T12:00:00Z");

    @Test
    @DisplayName("every entity scenario ends where the fixture says, with its gap reason, missing fields and asks")
    void scenarios() throws Exception {
        List<JsonNode> all = AuthorityScenarios.read("entity-scenarios.jsonl");
        assertThat(all).hasSizeGreaterThanOrEqualTo(18);
        for (JsonNode s : all) {
            String id = s.get("id").asText() + " — " + s.get("shape").asText();
            CapabilitySnapshot snap = AuthorityScenarios.snapshot(s, DetailCapability.READABLE);
            Set<EntityField> fields = EnumSet.noneOf(EntityField.class);
            s.get("request").forEach(f -> fields.add(EntityField.valueOf(f.asText())));
            Resolution r = s.get("id").asText().startsWith("E")
                    ? EntityStateResolver.resolveOrder(AuthorityScenarios.order(s), fields, snap,
                    snap.orderBound() ? AuthorityScenarios.ORDER_KEY : null)
                    : EntityStateResolver.resolveListing(listing(s), fields, AuthorityScenarios.text(s, "option"), snap, NOW);
            JsonNode e = s.get("expect");
            assertThat(r.state()).as(id).isEqualTo(ResolutionState.valueOf(e.get("state").asText()));
            assertThat(r.gap() == null ? null : r.gap().name()).as(id + " gap").isEqualTo(AuthorityScenarios.text(e, "gap"));
            if (e.has("missing")) {
                List<String> missing = new ArrayList<>();
                e.get("missing").forEach(m -> missing.add(m.asText()));
                assertThat(r.missing().stream().map(Enum::name).toList()).as(id + " missing").isEqualTo(missing);
            }
            if (e.has("ask")) {
                List<String> ask = new ArrayList<>();
                e.get("ask").forEach(m -> ask.add(m.asText()));
                assertThat(r.ask().stream().map(Enum::name).toList()).as(id + " ask").isEqualTo(ask);
            }
            if (e.has("observed")) {
                Map<String, String> want = new LinkedHashMap<>();
                e.get("observed").fields().forEachRemaining(x -> want.put(x.getKey(), x.getValue().asText()));
                Map<String, String> got = new LinkedHashMap<>();
                r.observed().forEach(o -> got.put(o.field().name(), o.value()));
                assertThat(got).as(id + " observed").containsAllEntriesOf(want);
            }
            if (e.has("observedFreshness")) {
                assertThat(r.observed()).as(id).isNotEmpty().allMatch(o -> o.provenance().freshness().name()
                        .equals(e.get("observedFreshness").asText()));
            }
            // provenance is always about THIS instance
            r.observed().forEach(o -> assertThat(o.provenance().entity().id()).as(id + " entity").isIn(
                    AuthorityScenarios.ORDER_KEY, AuthorityScenarios.PRODUCT.toString()));
        }
    }

    static ListingState listing(JsonNode s) {
        JsonNode l = s.get("listing");
        if (l == null || l.isNull()) {
            return null;
        }
        List<ListingState.Option> options = new ArrayList<>();
        l.get("options").forEach(o -> options.add(new ListingState.Option(o.get("label").asText(),
                SellingStatus.valueOf(o.get("status").asText()), NOW.minus(Duration.ofHours(o.get("ageHours").asLong())))));
        return new ListingState(AuthorityScenarios.PRODUCT, SellingStatus.valueOf(l.get("status").asText()),
                NOW.minus(Duration.ofHours(l.get("ageHours").asLong())), options);
    }
}
