package com.sellerops.inquiry.decision;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.inquiry.authority.CapabilityRegistry;
import com.sellerops.inquiry.authority.CapabilitySnapshot;
import com.sellerops.inquiry.resolution.ResolutionPlannerPrompt;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/** Operator probe (gated): how large the planner's request is, measured, so a cost estimate is not a guess. */
@EnabledIfEnvironmentVariable(named = "RUN_PLANNER_SIZE_PROBE", matches = "true")
class ResolutionPlannerSizeProbeTest {

    @Test
    void sizes() throws Exception {
        ObjectMapper json = new ObjectMapper();
        InquiryDecisionProperties props = new InquiryDecisionProperties(true, "*", "gpt-5-2025-08-07", "k", 800, 2400,
                "minimal", InquiryDecisionPrompt.JUDGE_V2, "", InquiryDecisionProperties.FORMAT_JSON_SCHEMA);
        InquiryDecisionGenerator gen = new InquiryDecisionGenerator((uri, h, b) -> null, props);
        List<Integer> v3 = new ArrayList<>();
        List<Integer> users = new ArrayList<>();
        for (String l : Files.readAllLines(Path.of(System.getenv("PLAN_INPUTS")))) {
            if (l.isBlank()) {
                continue;
            }
            JsonNode row = json.readTree(l);
            ResolutionPlannerRunner.Input in = ResolutionPlannerRunner.Input.of(row);
            CapabilitySnapshot snap = CapabilityRegistry.derive(in.registry());
            v3.add(gen.resolutionPlanBody(in.question(), snap).getBytes(StandardCharsets.UTF_8).length);
            users.add(ResolutionPlannerPrompt.user(in.question(), snap).getBytes(StandardCharsets.UTF_8).length);
        }
        int v2System = InquiryDecisionPrompt.planSystem().getBytes(StandardCharsets.UTF_8).length;
        int v3System = ResolutionPlannerPrompt.system().getBytes(StandardCharsets.UTF_8).length;
        int v2Body = gen.planBody("이 상품 폭이 얼마인가요?").getBytes(StandardCharsets.UTF_8).length;
        int v3Schema = ResolutionPlannerPrompt.schema(CapabilityRegistry.derive(ResolutionPlannerRunner.Input
                .of(json.readTree(Files.readAllLines(Path.of(System.getenv("PLAN_INPUTS"))).get(0))).registry()))
                .toString().getBytes(StandardCharsets.UTF_8).length;
        v3.sort(null);
        System.out.println("PLANNER_SIZE v2_system_bytes=" + v2System + " v2_plan_body_bytes=" + v2Body
                + " v3_system_bytes=" + v3System + " v3_schema_bytes=" + v3Schema
                + " v3_body_min=" + v3.get(0) + " v3_body_p50=" + v3.get(v3.size() / 2)
                + " v3_body_max=" + v3.get(v3.size() - 1)
                + " v3_user_p50=" + users.stream().sorted().toList().get(users.size() / 2));
    }
}
