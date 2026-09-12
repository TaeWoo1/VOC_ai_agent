package com.sellerops.agent.llm.converse;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

/**
 * <b>The reviewed ledger's own sentences, run through the floor that decides whether they may leave.</b>
 *
 * <p>The runtime renders these lines and this class refuses or accepts them, and until this test existed
 * the two halves were only ever checked apart — the runtime suite asserted on rendered text with no
 * floor in sight, the backend suite asserted on the floor with hand-typed strings, and both stayed green
 * while seven reviewed rows grew past {@link ConverseRequestFloor#MAX_FACT_LENGTH} and refused EVERY
 * product question. A grounded lane that silently falls back to the deterministic composer looks exactly
 * like a working one from either side alone.
 *
 * <p><b>No fact is typed here.</b> {@code contracts/product-truth/v1/converse-facts.json} is written by
 * the runtime test that renders it, from the reviewed ledger contract this backend generates — so a YAML
 * edit moves the ledger, the ledger moves the rendered lines, and the lines arrive here. A hand-typed
 * fixture would be the third copy of the ledger and would go stale first.
 *
 * <p><b>What a failure means.</b> Not "raise the limit". A line over the cap is a rendering that has to
 * split at its own clause boundary — trimming a reviewed sentence would make the renderer the author of
 * a claim nobody approved. A plan over the fact COUNT is the other question, and it is a
 * product-owner one: either the bound is re-sized to the sheet it is meant to bound, or the widest
 * selection stops sending every layer. This test states which plans are over, rather than choosing.
 */
class ProductTruthConverseFloorTest {

    private static final Path ARTIFACT =
            Path.of("..", "contracts", "product-truth", "v1", "converse-facts.json");
    private static final ObjectMapper MAPPER = new ObjectMapper();

    /**
     * <b>The runtime overlay's share of the same request.</b>
     *
     * The canonical facts in this artifact are not the whole payload: the sheet sends this deployment's
     * live state beside them — the channel list, each channel's offer, this seller's readiness, whether
     * collection is running, and the execution lines for channels this deployment has narrowed. Live on
     * the Demo Org that is 10 to 12 lines, so a plan is inside the floor only with room for them. A
     * canonical half that fits alone and a request that is refused is exactly the gap this class exists
     * to close.
     */
    private static final int RUNTIME_OVERLAY_LINES = 12;

    /** A question of the shape this lane actually receives, and the closed-token envelope beside it. */
    private static final String QUESTION = "카페24 리뷰는 자동으로 가져와?";
    private static final List<String> CONTEXT = List.of("focus=NONE", "readiness=WORKING");
    private static final List<String> TURNS = List.of();

    private static List<Plan> plans() throws Exception {
        JsonNode root = MAPPER.readTree(Files.readString(ARTIFACT));
        List<Plan> out = new ArrayList<>();
        for (JsonNode node : root) {
            List<String> facts = new ArrayList<>();
            node.get("facts").forEach(f -> facts.add(f.asText()));
            List<String> ids = new ArrayList<>();
            node.get("ids").forEach(f -> ids.add(f.asText()));
            out.add(new Plan(node.get("plan").asText(), facts, ids));
        }
        return out;
    }

    /**
     * The regression this test was written for: one over-long line refuses the WHOLE request, so this
     * asserts the property for every plan the selector can produce, not only the one a probe happened
     * to use.
     */
    @TestFactory
    Iterable<DynamicTest> everyRenderedFactFitsOneLineOfTheFloor() throws Exception {
        List<DynamicTest> tests = new ArrayList<>();
        for (Plan plan : plans()) {
            tests.add(DynamicTest.dynamicTest(plan.label() + " — 줄 길이", () -> {
                for (String fact : plan.facts()) {
                    assertThat(fact).isNotBlank();
                    assertThat(fact.length())
                            .as("%s 의 사실 한 줄이 floor 를 넘습니다: %s", plan.label(),
                                    fact.substring(0, Math.min(60, fact.length())))
                            .isLessThanOrEqualTo(ConverseRequestFloor.MAX_FACT_LENGTH);
                }
            }));
        }
        return tests;
    }

    /**
     * The whole floor, on the plans whose payload fits it — these are the shapes a seller's product
     * question resolves to in the sittings this lane was built for, and each must be ACCEPTED rather
     * than merely short enough.
     */
    @TestFactory
    Iterable<DynamicTest> thePlansThatFitAreAcceptedByTheProductionFloor() throws Exception {
        List<DynamicTest> tests = new ArrayList<>();
        for (Plan plan : plans()) {
            if (!fits(plan)) {
                continue;
            }
            tests.add(DynamicTest.dynamicTest(plan.label() + " — floor 통과", () ->
                    assertThat(ConverseRequestFloor.isSafe(QUESTION, plan.facts(), CONTEXT, TURNS))
                            .as("%s 의 사실이 floor 에 거절됩니다", plan.label())
                            .isTrue()));
        }
        return tests;
    }

    /**
     * The channel plan the manual QA probe uses, pinned by name so the shape that must work cannot
     * quietly leave the set above by growing past the count bound.
     */
    @Test
    void theCafe24ChannelPlanIsAcceptedWhole() throws Exception {
        Plan plan = named("CHANNEL_ACTION+CAFE24");
        assertThat(fits(plan)).isTrue();
        assertThat(ConverseRequestFloor.isSafe(QUESTION, plan.facts(), CONTEXT, TURNS)).isTrue();
        assertThat(plan.facts()).anySatisfy(f -> assertThat(f).contains("자동으로 가져올 수 있습니다"));
    }

    /**
     * 「판매자센터랑 뭐가 달라?」 — the question that used to arrive with no aspect and take the widest
     * selection in the file. It is answered by the narrative written to answer it, and the assertions
     * are what that means: the narrative is there, the channel grid and the roadmap are not, and the
     * whole thing is inside the floor with room for the runtime overlay.
     */
    @Test
    void theDifferenceQuestionIsNarrowAndAccepted() throws Exception {
        Plan plan = named("PRODUCT_DIFFERENCE");
        assertThat(fits(plan)).as("사실 %d개 + overlay 여유", plan.facts().size()).isTrue();
        assertThat(ConverseRequestFloor.isSafe(QUESTION, plan.facts(), CONTEXT, TURNS)).isTrue();
        assertThat(plan.ids()).contains("NARRATIVE.SELLER_CENTER_DIFFERENCE");
        assertThat(plan.ids()).noneMatch(id -> id.startsWith("ROADMAP."));
        assertThat(plan.ids()).noneMatch(id -> id.startsWith("CAFE24.") || id.startsWith("NAVER.")
                || id.startsWith("COUPANG."));
    }

    /**
     * 「앞으로 뭐 할 거야?」 — the other one. Both future layers travel whole, and every roadmap line
     * carries the hedge that keeps a plan from being read as a feature. That hedge is asserted here, on
     * the payload, rather than left to the prompt rule that asks the model to repeat it.
     */
    @Test
    void theFutureQuestionCarriesBothFutureLayersWithTheirQualifiers() throws Exception {
        Plan plan = named("FUTURE_DIRECTION");
        assertThat(fits(plan)).as("사실 %d개 + overlay 여유", plan.facts().size()).isTrue();
        assertThat(ConverseRequestFloor.isSafe(QUESTION, plan.facts(), CONTEXT, TURNS)).isTrue();
        assertThat(plan.ids()).anyMatch(id -> id.startsWith("DIRECTION."));
        assertThat(plan.ids()).anyMatch(id -> id.startsWith("ROADMAP."));
        for (int i = 0; i < plan.ids().size(); i++) {
            if (plan.ids().get(i).startsWith("ROADMAP.")) {
                assertThat(plan.facts().get(i)).contains("앞으로의 방향(현재 제공되는 기능이 아닙니다)");
            }
        }
    }

    /**
     * The two v19 aspects: a question about whether collection is running, and one about how the
     * product is used day to day. Both are answered from acquisition and live state — manual QA watched
     * the first come back with a product catalogue beside it and the second with the day's inquiry
     * count, and neither belongs in an answer about reviewnary.
     */
    @Test
    void theStateAndOperationPlansAreNarrowAndAccepted() throws Exception {
        for (String label : List.of("COLLECTION_STATE", "DAILY_OPERATION")) {
            Plan plan = named(label);
            assertThat(fits(plan)).as("%s: 사실 %d개", label, plan.facts().size()).isTrue();
            assertThat(ConverseRequestFloor.isSafe(QUESTION, plan.facts(), CONTEXT, TURNS)).isTrue();
            assertThat(plan.ids()).as(label).anyMatch(id -> id.endsWith(".ACQUISITION"));
            // A state question is not a catalogue of what may be sent.
            assertThat(plan.ids()).as(label).noneMatch(id -> id.contains(".EXECUTION"));
        }
    }

    /** 「파일로 올릴 수도 있어?」 — the ledger's own statement of what a file may carry. */
    @Test
    void theConnectionPlansCarryTheManualFilePath() throws Exception {
        for (String label : List.of("HOW_TO_CONNECT", "SUPPORTED_CHANNELS")) {
            assertThat(named(label).ids()).as(label).contains("FEATURE.MANUAL_FILE_ACQUISITION");
        }
    }

    /**
     * The two v21 aspects. Both questions used to plan as PRODUCT_OVERVIEW and arrive at 79 lines
     * against a floor of 80 — right answers one ledger addition away from silently becoming the old
     * composed ones. Each now stands on the handful of reviewed items that answer it.
     */
    @Test
    void theTeamAndSecurityPlansStandOnTheirOwnItems() throws Exception {
        Plan team = named("TEAM_ACCESS");
        assertThat(fits(team)).isTrue();
        assertThat(ConverseRequestFloor.isSafe(QUESTION, team.facts(), CONTEXT, TURNS)).isTrue();
        assertThat(team.ids()).contains("FEATURE.ACCOUNT_AND_ORGANIZATION", "ROADMAP.TEAM_ACCESS");

        Plan security = named("SECURITY_AND_DATA");
        assertThat(fits(security)).isTrue();
        assertThat(ConverseRequestFloor.isSafe(QUESTION, security.facts(), CONTEXT, TURNS)).isTrue();
        assertThat(security.ids()).contains("FEATURE.CHANNEL_CREDENTIAL_STORAGE",
                "FEATURE.HELPER_DEVICE_ACCESS", "INVARIANT.ORG_ISOLATION",
                "INVARIANT.SECURITY_CLAIM_LIMIT");

        // Neither carries the channel grid, and both leave the floor plenty of room.
        for (Plan plan : List.of(team, security)) {
            assertThat(plan.ids()).noneMatch(id -> id.startsWith("CAFE24.") || id.startsWith("NAVER.")
                    || id.startsWith("COUPANG."));
            assertThat(plan.facts().size() + RUNTIME_OVERLAY_LINES)
                    .isLessThan(ConverseRequestFloor.MAX_FACTS / 2);
        }
    }

    private Plan named(String label) throws Exception {
        return plans().stream().filter(p -> p.label().equals(label)).findFirst()
                .orElseThrow(() -> new AssertionError(label + " 계획이 계약 파일에 없습니다"));
    }

    /** Inside the floor's count bound with room for the lines the runtime overlay adds beside these. */
    private static boolean fits(Plan plan) {
        return plan.facts().size() + RUNTIME_OVERLAY_LINES <= ConverseRequestFloor.MAX_FACTS;
    }

    /**
     * <b>Reported, not decided.</b> The widest selections send more lines than the floor's count bound,
     * and that bound's own rationale is the size of a legitimate fact sheet — which grew when the
     * reviewed ledger became the sheet. Re-sizing it, or narrowing what the widest question sends, is a
     * product-owner decision; what this test owns is that the number stops being invisible.
     */
    /**
     * <b>How close the widest ACCEPTED plan is, stated as a number rather than left to be discovered.</b>
     *
     * Adding six reviewed items moved {@code PRODUCT_OVERVIEW} from 60 facts to 66, and with the
     * overlay beside it that is two lines under the bound. The next few additions to the ledger will
     * push a plan that works today over it, and the failure is silent to a seller — the grounded answer
     * is simply replaced by the older composed one. So the margin is asserted: this fails while there is
     * still room to decide, rather than after a QA sitting notices the answer changed.
     */
    @Test
    void theWidestAcceptedPlanStillHasRoomForTheOverlay() throws Exception {
        int worst = plans().stream().filter(ProductTruthConverseFloorTest::fits)
                .mapToInt(p -> p.facts().size()).max().orElseThrow();
        assertThat(worst + RUNTIME_OVERLAY_LINES)
                .as("floor 상한 %d 에 가장 가까운 계획", ConverseRequestFloor.MAX_FACTS)
                .isLessThanOrEqualTo(ConverseRequestFloor.MAX_FACTS);
        assertThat(worst).as("가장 큰 통과 계획의 사실 수").isEqualTo(66);
    }

    @Test
    void plansOverTheCountBoundAreNamedRatherThanHidden() throws Exception {
        List<String> over = plans().stream()
                .filter(p -> !fits(p))
                .map(p -> p.label() + "=" + p.facts().size())
                .toList();
        // Only the unplaced shapes, and only because unplaced WIDENS on purpose. Every question the
        // planner can place is inside the bound; a question it cannot place is one we know nothing
        // about, and narrowing that one to fit would be answering a narrower question than was asked.
        assertThat(over)
                .as("floor 의 사실 개수 상한(%d)에 overlay %d줄까지 더해 넘는 계획",
                        ConverseRequestFloor.MAX_FACTS, RUNTIME_OVERLAY_LINES)
                .containsExactly("UNPLACED=79", "UNPLACED+INQUIRY=91");
    }

    private record Plan(String label, List<String> facts, List<String> ids) {
    }
}
