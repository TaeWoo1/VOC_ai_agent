package com.sellerops.inquiry.authority;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.inquiry.decision.NeedType;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The production enums and {@code contracts/inquiry-authority/v1/vocabulary.json} — which the plan gold, the plan scorer
 * and (later) the Resolution Planner's strict schema all read — are one vocabulary. A value added on one side only fails
 * here, not in an eval three packages later.
 */
class AuthorityVocabularyContractTest {

    static final JsonNode V = read();

    static JsonNode read() {
        try {
            return new ObjectMapper().readTree(Path.of("..", "contracts", "inquiry-authority", "v1", "vocabulary.json")
                    .toFile());
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    static List<String> strings(JsonNode arr) {
        List<String> out = new ArrayList<>();
        arr.forEach(x -> out.add(x.isTextual() ? x.asText() : x.get("id").asText()));
        return out;
    }

    static <E extends Enum<E>> List<String> names(E[] values) {
        return Arrays.stream(values).map(Enum::name).toList();
    }

    @Test
    @DisplayName("authorities, statuses, states, gap reasons and surfaces are the same lists in the same order")
    void closedLists() {
        assertThat(strings(V.get("authorities"))).isEqualTo(names(Authority.values()));
        assertThat(strings(V.get("capability_statuses"))).isEqualTo(names(CapabilityStatus.values()));
        assertThat(strings(V.get("resolution_states"))).isEqualTo(names(ResolutionState.values()));
        assertThat(strings(V.get("gap_reasons"))).isEqualTo(names(GapReason.values()));
        assertThat(strings(V.get("surfaces"))).isEqualTo(names(InquirySurface.values()));
    }

    /**
     * WP-3 moved {@code effect} off the planned step and onto the capability. Two things are pinned here: the registry
     * and the contract file agree on every capability's effect, and {@link ExecutionEffect#BOUNDED_WORKFLOW} has
     * <b>no declaring capability</b> — the shadow measured the planner reaching for that word 38 times while the gold
     * never uses it, so the token stays in the vocabulary but nothing produces it. This assertion is the switch: a
     * capability that starts declaring a bounded workflow has to turn it off deliberately.
     */
    @Test
    @DisplayName("the registry declares each capability's effect, and BOUNDED_WORKFLOW has no producer")
    void effectIsTheRegistrys() {
        V.get("capabilities").forEach(c -> assertThat(CapabilityId.ofWire(c.get("id").asText()).effect().name())
                .as(c.get("id").asText()).isEqualTo(c.get("effect").asText()));
        assertThat(java.util.Arrays.stream(CapabilityId.values())
                .filter(c -> c.effect() == ExecutionEffect.BOUNDED_WORKFLOW).toList())
                .as("no capability declares a bounded workflow in v3.0").isEmpty();
        assertThat(java.util.Arrays.stream(CapabilityId.values())
                .filter(c -> c.effect() != ExecutionEffect.NONE).toList())
                .as("only a procedure changes the world outside this system")
                .containsExactly(CapabilityId.PROCEDURE_ORDER_ACTION);
    }

    @Test
    @DisplayName("capabilities carry the same wire id and authority; fields the same owning capability")
    void capabilitiesAndFields() {
        Map<String, String> json = new LinkedHashMap<>();
        V.get("capabilities").forEach(c -> json.put(c.get("id").asText(), c.get("authority").asText()));
        Map<String, String> java = new LinkedHashMap<>();
        for (CapabilityId c : CapabilityId.values()) {
            java.put(c.wire(), c.authority().name());
        }
        assertThat(json).containsExactlyEntriesOf(java);
        Map<String, String> jf = new LinkedHashMap<>();
        V.get("entity_fields").forEach(f -> jf.put(f.get("id").asText(), f.get("capability").asText()));
        Map<String, String> javaF = new LinkedHashMap<>();
        for (EntityField f : EntityField.values()) {
            javaF.put(f.name(), f.capability().wire());
        }
        assertThat(jf).containsExactlyEntriesOf(javaF);
    }

    @Test
    @DisplayName("customer inputs have the same kinds, and identity is not askable on either side")
    void customerInputs() {
        Map<String, String> jf = new LinkedHashMap<>();
        V.get("customer_inputs").forEach(i -> jf.put(i.get("id").asText(), i.get("kind").asText()));
        Map<String, String> java = new LinkedHashMap<>();
        for (CustomerInput i : CustomerInput.values()) {
            java.put(i.name(), i.kind().name());
        }
        assertThat(jf).containsExactlyEntriesOf(java);
        assertThat(V.get("askable").get("IDENTITY").asBoolean()).isFalse();
        for (CustomerInput i : CustomerInput.values()) {
            for (InquirySurface s : InquirySurface.values()) {
                assertThat(i.askableOn(s)).as(i + " on " + s).isEqualTo(i.kind() == CustomerInput.Kind.PRODUCT_CONTEXT);
            }
        }
    }

    @Test
    @DisplayName("the v2 bridge in the vocabulary is AuthorityFence.planned, for every NeedType")
    void bridge() {
        Map<String, String> json = new LinkedHashMap<>();
        V.get("v2_bridge").fields().forEachRemaining(e -> json.put(e.getKey(), e.getValue().asText()));
        Map<String, String> java = new LinkedHashMap<>();
        for (NeedType t : NeedType.values()) {
            java.put(t.name(), AuthorityFence.planned(t).wire());
        }
        assertThat(json).containsExactlyInAnyOrderEntriesOf(java);
    }
}
