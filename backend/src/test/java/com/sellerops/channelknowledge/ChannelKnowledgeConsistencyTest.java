package com.sellerops.channelknowledge;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.collect.AcquisitionPathRegistry;
import com.sellerops.connector.ChannelApiGapRegistry;
import com.sellerops.connector.DataType;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

/**
 * The drift fence.
 *
 * <p>A knowledge base that describes a system is a second copy of that system's rules, and second
 * copies rot. These assertions pin the entries that state a fact the code ALSO states, so the build
 * fails the moment the two disagree — rather than an Agent confidently telling a seller something
 * that stopped being true three releases ago.
 *
 * <p>This is not hypothetical. The Cafe24 OAuth scope list existed in three places in this
 * repository: a Java {@code @Value} default listing three scopes with a comment promising "new
 * connections consent to all three at once", an {@code application.yml} default listing two that
 * silently won because a {@code @Value} default only applies when the property is absent, and a
 * tutorial page listing two others. Every new Cafe24 connection consented to the wrong set, and
 * nothing anywhere noticed.
 */
class ChannelKnowledgeConsistencyTest {

    private static final ChannelKnowledgePack PACK = new ChannelKnowledgePack();
    private static final Path REPO = Path.of("..").toAbsolutePath().normalize();

    @Test
    void everyChannelHasAPackCoveringAllEightKnowledgeAreas() {
        for (String channel : PACK.channels()) {
            List<ChannelKnowledgeEntry> entries = PACK.entriesFor(channel);
            assertThat(entries).as("%s pack", channel).isNotEmpty();
            Set<ChannelKnowledgeTopic> topics =
                    entries.stream().map(ChannelKnowledgeEntry::topic).collect(Collectors.toSet());
            // A missing area should be visibly missing rather than quietly thin — an Agent asked about
            // troubleshooting for a channel with no troubleshooting entries would otherwise improvise.
            assertThat(topics).as("%s knowledge areas", channel)
                    .containsExactlyInAnyOrder(ChannelKnowledgeTopic.values());
        }
    }

    @Test
    void everyEntryCarriesItsProvenanceAndTheDateItWasLastTrue() {
        for (ChannelKnowledgeEntry e : PACK.all()) {
            assertThat(e.title()).as("%s title", e.id()).isNotBlank();
            assertThat(e.summary()).as("%s summary", e.id()).isNotBlank();
            assertThat(e.source()).as("%s source", e.id()).isNotNull();
            assertThat(e.sourceRef()).as("%s sourceRef", e.id()).isNotBlank();
            // An undated fact is indistinguishable from a fact that stopped being true, which is the
            // failure mode this whole axis exists to avoid.
            assertThat(e.verifiedAt()).as("%s verifiedAt", e.id()).isNotNull();
        }
    }

    /**
     * The Cafe24 scope fact, pinned against the file that actually decides it.
     *
     * <p>{@code application.yml} is asserted rather than the Java {@code @Value} default precisely
     * because the yml is the one that wins. Asserting the Java default would have passed happily
     * throughout the entire period the deployment was consenting to the wrong scopes.
     */
    @Test
    void cafe24ScopeKnowledgeMatchesTheScopesTheDeploymentActuallyRequests() throws Exception {
        String yml = Files.readString(
                REPO.resolve("backend/src/main/resources/application.yml"), StandardCharsets.UTF_8);
        String scopeLine = yml.lines()
                .filter(l -> l.contains("SELLEROPS_CONNECTOR_CAFE24_SCOPES"))
                .findFirst()
                .orElseThrow(() -> new AssertionError("Cafe24 scope property not found in application.yml"));

        assertThat(scopeLine).contains("mall.read_order", "mall.read_community", "mall.read_product");
        // READ-ONLY by contract, and the knowledge pack says so to both the seller and the Agent.
        assertThat(scopeLine).doesNotContain("write");

        ChannelKnowledgeEntry scopes = entry("cafe24-conn-oauth-scopes");
        assertThat(scopes.summary()).contains("mall.read_order", "mall.read_community", "mall.read_product");
        assertThat(entry("cafe24-cap-product").summary()).contains("mall.read_product");

        // Third copy: the consent tutorial's own list. It shows the seller what the consent screen
        // will ask for, so a list that disagrees with the request teaches them to expect a different
        // screen than the one they get — and this page was listing two of the three.
        String tutorial = Files.readString(
                REPO.resolve("frontend/src/pages/Cafe24Tutorial.tsx"), StandardCharsets.UTF_8);
        assertThat(tutorial).contains("mall.read_order", "mall.read_community", "mall.read_product");
    }

    /**
     * Acquisition entries must agree with the registry, including the recurrence — the axis that
     * distinguishes "collected hourly" from "collected when the seller exports a file", and the one an
     * Agent will otherwise flatten into "collected".
     */
    @Test
    void acquisitionKnowledgeMatchesTheAcquisitionRegistry() {
        assertAcquisition("coupang-cap-review-action-window", "COUPANG", DataType.REVIEW,
                "ACTION_WINDOW", "SELLER_REPEATED");
        assertAcquisition("naver-cap-review-export", "NAVER", DataType.REVIEW,
                "EXPORT", "SELLER_REPEATED");
    }

    private static void assertAcquisition(String entryId, String channel, DataType type,
                                          String method, String recurrence) {
        var paths = AcquisitionPathRegistry.pathsFor(channel, type);
        assertThat(paths).as("%s/%s registry", channel, type).singleElement().satisfies(p -> {
            assertThat(p.method()).isEqualTo(method);
            assertThat(p.recurrence()).isEqualTo(recurrence);
        });
        ChannelKnowledgeEntry e = entry(entryId);
        assertThat(e.body() + " " + e.summary()).as("%s states its route", entryId)
                .contains(method).contains(recurrence);
    }

    /**
     * A channel with no official API for a type must say so as a LIMITATION, not merely fail to
     * mention it. Silence reads as "not implemented yet", which sends a seller looking for a setting
     * that will never exist.
     */
    @Test
    void missingOfficialApisAreStatedAsLimitationsRatherThanOmitted() {
        for (String id : List.of("coupang-cap-review-no-api", "naver-cap-review-no-api")) {
            assertThat(entry(id).kind()).as("%s kind", id).isEqualTo(ChannelKnowledgeKind.LIMITATION);
        }
        // And the code registry must agree. A limitation the pack asserts while the registry stays
        // silent is the same drift in the other direction: the Agent would say the API does not exist
        // while the operator screen showed nothing about it.
        for (String channel : List.of("COUPANG", "NAVER")) {
            assertThat(ChannelApiGapRegistry.gapsFor(channel))
                    .as("%s API gaps", channel)
                    .anySatisfy(g -> assertThat(g.code()).isEqualTo("REVIEW_API"));
        }
    }

    /** Unverified claims must be hedged in their own wording, since an Agent will quote them verbatim. */
    @Test
    void unverifiedEntriesHedgeTheirOwnWording() {
        for (ChannelKnowledgeEntry e : PACK.all()) {
            if (e.source() == ChannelKnowledgeSource.UNVERIFIED) {
                String text = e.summary() + " " + (e.body() == null ? "" : e.body()) + " " + e.sourceRef();
                assertThat(text).as("%s hedges", e.id())
                        .containsAnyOf("다를 수 있", "미확정", "가능성", "수 있습니다");
            }
        }
    }

    /**
     * Channel Knowledge is PLATFORM knowledge. Seller-specific policy — shipping rules, refund terms,
     * CS tone, brand voice — varies per seller and belongs to a system this package does not build.
     * One seller's shipping rule reaching another seller's Agent is the concrete harm.
     */
    @Test
    void noEntryCarriesSellerSpecificPolicy() {
        for (ChannelKnowledgeEntry e : PACK.all()) {
            String text = (e.title() + " " + e.summary() + " " + (e.body() == null ? "" : e.body()));
            assertThat(text).as("%s stays platform-level", e.id())
                    .doesNotContain("우리 쇼핑몰은")
                    .doesNotContain("당사")
                    .doesNotContain("무료배송 기준");
        }
    }

    private static ChannelKnowledgeEntry entry(String id) {
        return PACK.all().stream().filter(e -> e.id().equals(id)).findFirst()
                .orElseThrow(() -> new AssertionError("no such knowledge entry: " + id));
    }
}
