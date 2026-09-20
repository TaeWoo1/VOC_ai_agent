package com.sellerops.inquiry.resolution;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.inquiry.authority.CapabilityRegistry;
import com.sellerops.inquiry.authority.CapabilitySnapshot;
import com.sellerops.inquiry.decision.DetailCapability;
import com.sellerops.order.fact.OrderFactLookup;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Reads {@code contracts/inquiry-planner/v1/synthetic/planner-scenarios.jsonl} (test support). */
final class PlannerScenarios {

    static final Path FILE = Path.of("..", "contracts", "inquiry-planner", "v1", "synthetic",
            "planner-scenarios.jsonl");
    static final ObjectMapper JSON = new ObjectMapper();
    static final UUID PRODUCT = UUID.fromString("00000000-0000-0000-0000-00000000b001");

    private PlannerScenarios() {
    }

    static List<JsonNode> all() throws IOException {
        List<JsonNode> out = new ArrayList<>();
        for (String l : Files.readAllLines(FILE)) {
            if (!l.isBlank()) {
                out.add(JSON.readTree(l));
            }
        }
        return out;
    }

    static CapabilitySnapshot snapshot(JsonNode scenario) {
        JsonNode r = scenario.get("registry");
        return CapabilityRegistry.derive(new CapabilityRegistry.Inputs(
                r.path("channel").asText(null), r.hasNonNull("subtype") ? r.get("subtype").asText() : null,
                r.path("orderBound").asBoolean(false), OrderFactLookup.valueOf(r.path("lookup").asText("STORED_ONLY")),
                r.path("product").asBoolean(true) ? PRODUCT : null,
                DetailCapability.valueOf(r.path("detail").asText("READABLE")), r.path("listingRow").asBoolean(false),
                r.path("variantCount").asInt(0)));
    }

    /** The fixture's plan, through the production parser — so a fixture that the parser refuses fails loudly. */
    static ResolutionPlan plan(JsonNode scenario) {
        ResolutionPlanParser.Parsed parsed = ResolutionPlanParser.parse(scenario.get("plan").toString());
        if (parsed.plan() == null) {
            throw new IllegalStateException(scenario.get("id").asText() + ": the fixture plan does not parse: "
                    + parsed.failure());
        }
        return parsed.plan();
    }
}
