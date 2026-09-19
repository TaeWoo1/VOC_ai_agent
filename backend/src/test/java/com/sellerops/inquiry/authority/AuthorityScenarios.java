package com.sellerops.inquiry.authority;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.coverage.ChannelDataState;
import com.sellerops.inquiry.decision.DetailCapability;
import com.sellerops.order.fact.OrderCancellationState;
import com.sellerops.order.fact.OrderFact;
import com.sellerops.order.fact.OrderFactLookup;
import com.sellerops.order.fact.OrderFactProvenance;
import com.sellerops.order.fact.OrderFactState;
import com.sellerops.order.fact.OrderFulfillmentState;
import com.sellerops.order.fact.OrderPaymentState;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Reads the synthetic scenario fixtures in {@code contracts/inquiry-authority/v1/synthetic} (test support). */
final class AuthorityScenarios {

    static final Path DIR = Path.of("..", "contracts", "inquiry-authority", "v1", "synthetic");
    static final ObjectMapper JSON = new ObjectMapper();
    static final UUID PRODUCT = UUID.fromString("00000000-0000-0000-0000-00000000a001");
    static final String ORDER_KEY = "channel|ORD-THIS";

    private AuthorityScenarios() {
    }

    static List<JsonNode> read(String file) throws IOException {
        List<JsonNode> out = new ArrayList<>();
        for (String l : Files.readAllLines(DIR.resolve(file))) {
            if (!l.isBlank()) {
                out.add(JSON.readTree(l));
            }
        }
        return out;
    }

    static String text(JsonNode n, String field) {
        JsonNode v = n.get(field);
        return v == null || v.isNull() ? null : v.asText();
    }

    static CapabilitySnapshot snapshot(JsonNode s, DetailCapability detail) {
        JsonNode r = s.get("registry");
        boolean product = !r.path("noProduct").asBoolean(false);
        return CapabilityRegistry.derive(new CapabilityRegistry.Inputs(text(r, "channel"), text(r, "subtype"),
                r.path("orderBound").asBoolean(false),
                r.has("lookup") ? OrderFactLookup.valueOf(r.get("lookup").asText()) : OrderFactLookup.STORED_ONLY,
                product ? PRODUCT : null, detail, r.path("listingRow").asBoolean(false), r.path("variantCount").asInt(0)));
    }

    static OrderFact order(JsonNode s) {
        JsonNode o = s.get("order");
        if (o == null || o.isNull()) {
            return null;
        }
        OrderFactState state = OrderFactState.valueOf(o.get("state").asText());
        if (!state.hasObservation()) {
            return OrderFact.unavailable(state, null, text(s.get("registry"), "channel"));
        }
        return new OrderFact(state, OrderFactProvenance.valueOf(o.get("provenance").asText()),
                state == OrderFactState.OBSERVED_FRESH ? ChannelDataState.OBSERVED_FRESH
                        : ChannelDataState.OBSERVED_FRESHNESS_UNPROVEN,
                text(s.get("registry"), "channel"),
                o.has("payment") ? OrderPaymentState.valueOf(o.get("payment").asText()) : null,
                o.has("cancellation") ? OrderCancellationState.valueOf(o.get("cancellation").asText()) : null,
                o.has("fulfillment") ? OrderFulfillmentState.valueOf(o.get("fulfillment").asText()) : null,
                null, null, null, null, null, Instant.parse("2026-09-20T00:00:00Z"));
    }
}
