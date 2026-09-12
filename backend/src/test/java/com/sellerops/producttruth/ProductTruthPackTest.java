package com.sellerops.producttruth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * The ledger's own rules — that it loads, that it is complete, and that the four layers cannot be
 * read as one another.
 *
 * <p>Every negative case here is built by hand rather than by editing the shipped files, so the rule
 * is proven rather than the current content merely happening to satisfy it.
 */
class ProductTruthPackTest {

    private static final ProductTruthPack PACK = ProductTruthPack.load();
    private static final LocalDate TODAY = LocalDate.parse("2026-09-08");

    // ---- the shipped ledger ------------------------------------------------------------------

    @Test
    void theShippedLedgerLoadsAndSatisfiesEveryRule() {
        // load() throws with the full violation list; reaching here is the assertion.
        assertThat(PACK.capabilities()).isNotEmpty();
        assertThat(PACK.invariants()).isNotEmpty();
        assertThat(PACK.narratives()).isNotEmpty();
        assertThat(PACK.roadmap()).isNotEmpty();
        assertThat(PACK.features()).isNotEmpty();
        assertThat(PACK.directions()).isNotEmpty();
    }

    @Test
    void everyChannelDeclaresEveryObjectOnEveryAxis() {
        for (String channel : ProductTruthPack.CHANNELS) {
            for (String object : ProductTruthPack.OBJECTS) {
                assertThat(PACK.capabilitiesFor(channel, object))
                        .as("%s %s", channel, object)
                        .extracting(ProductCapability::axis)
                        .containsExactly(ProductCapabilityAxis.values());
            }
        }
    }

    @Test
    void noIdIsUsedTwiceAnywhereInTheLedger() {
        assertThat(ProductTruthPack.duplicates(PACK.allIds())).isEmpty();
    }

    /**
     * The separation is structural, not a naming convention: there is no type a roadmap item and a
     * capability share, so nothing can walk them together and read a direction as a feature.
     */
    @Test
    void aRoadmapItemCannotBeReadAsACapability() {
        assertThat(ProductRoadmapItem.class.getInterfaces()).isEmpty();
        assertThat(ProductCapability.class.getInterfaces()).isEmpty();
        List<String> roadmapFields = List.of(ProductRoadmapItem.class.getRecordComponents())
                .stream().map(java.lang.reflect.RecordComponent::getName).toList();
        // No status/mode/evidence to mistake for a capability claim.
        assertThat(roadmapFields).doesNotContain("mode", "evidence", "axis", "channel", "object");
        assertThat(PACK.roadmap()).allSatisfy(r -> assertThat(r.id()).startsWith("ROADMAP."));
        assertThat(PACK.capabilities()).allSatisfy(c -> assertThat(c.id()).doesNotStartWith("ROADMAP."));
    }

    @Test
    void everyRoadmapItemCarriesTheQualifierAnAnswerMustSayWithIt() {
        assertThat(PACK.roadmap()).allSatisfy(r -> {
            assertThat(r.qualifier()).as("%s qualifier", r.id()).isNotBlank();
            assertThat(r.status()).isIn(ProductRoadmapStatus.PLANNED, ProductRoadmapStatus.EXPLORING,
                    ProductRoadmapStatus.NOT_COMMITTED);
        });
    }

    /**
     * The specific regression this ledger was built for. Cafe24 is the only one of the three channels
     * that reads reviews through an official API, and a Grounded Conversation answer lost that fact
     * because it was re-derived from a registry that was off.
     */
    @Test
    void cafe24ReviewAcquisitionIsAutomaticAndLiveProven() {
        ProductCapability c = PACK.capability("CAFE24", "REVIEW", ProductCapabilityAxis.ACQUISITION)
                .orElseThrow();
        assertThat(c.status()).isEqualTo(ProductCapabilityStatus.SUPPORTED);
        assertThat(c.mode()).isEqualTo(ProductCapabilityMode.AUTOMATIC);
        assertThat(c.evidence()).isEqualTo(ProductEvidence.LIVE_PROVEN);
    }

    /** The other half: a channel that offers sellers no reply feature at all. */
    @Test
    void coupangReviewHasNoReplyAndThereforeNoDraftLane() {
        ProductCapability execution = PACK.capability("COUPANG", "REVIEW", ProductCapabilityAxis.EXECUTION)
                .orElseThrow();
        assertThat(execution.status()).isEqualTo(ProductCapabilityStatus.NOT_SUPPORTED);
        assertThat(execution.mode()).isEqualTo(ProductCapabilityMode.NONE);
        // A review with no reply feature must never fall into the "copy it into the seller center"
        // group — there is nothing to copy it into, so no draft is prepared either.
        assertThat(PACK.capability("COUPANG", "REVIEW", ProductCapabilityAxis.DRAFT).orElseThrow().mode())
                .isEqualTo(ProductCapabilityMode.NONE);
        assertThat(execution.limitations()).anySatisfy(l -> assertThat(l).contains("아직"));
    }

    /** NAVER review: acquisition, execution and who presses submit are three separate answers. */
    @Test
    void naverReviewSeparatesGuidedAcquisitionFromGuidedExecutionAndSellerSubmit() {
        ProductCapability acquisition = PACK.capability("NAVER", "REVIEW", ProductCapabilityAxis.ACQUISITION)
                .orElseThrow();
        assertThat(acquisition.mode()).isEqualTo(ProductCapabilityMode.SELLER_GUIDED);

        ProductCapability execution = PACK.capability("NAVER", "REVIEW", ProductCapabilityAxis.EXECUTION)
                .orElseThrow();
        assertThat(execution.mode()).isEqualTo(ProductCapabilityMode.GUIDED_WITH_APPROVAL);
        // Filled is not posted, and the ledger has to keep saying so.
        assertThat(execution.limitations())
                .anySatisfy(l -> assertThat(l).contains("등록된 것이 아닙니다"));
    }

    /**
     * The QA posture that started this: a publish flag being off is a runtime fact, and the ledger
     * that owns product capability must contain no flag at all.
     */
    @Test
    void theLedgerNeverReadsARuntimeFlag() {
        assertThat(PACK.capabilities()).allSatisfy(c -> {
            assertThat(c.evidenceRef()).doesNotContain("_ENABLED");
            c.sellerFacingNotes().forEach(n -> assertThat(n)
                    .as("%s seller sentence", c.id())
                    .doesNotContain("sellerops.").doesNotContain("ENABLED"));
        });
    }

    @Test
    void liveProvenEvidenceSurvivesAsLiveProven() {
        // The rows a stale registry or a switched-off connector previously demoted.
        assertThat(PACK.capability("COUPANG", "INQUIRY", ProductCapabilityAxis.ACQUISITION)
                .orElseThrow().evidence()).isEqualTo(ProductEvidence.LIVE_PROVEN);
        assertThat(PACK.capability("CAFE24", "INQUIRY", ProductCapabilityAxis.EXECUTION)
                .orElseThrow().evidence()).isEqualTo(ProductEvidence.LIVE_PROVEN);
        assertThat(PACK.capability("NAVER", "INQUIRY", ProductCapabilityAxis.EXECUTION)
                .orElseThrow().evidence()).isEqualTo(ProductEvidence.LIVE_PROVEN);
    }

    /**
     * The correction this v2 pass was built for. Cafe24 PRODUCT was written as PARTIAL · IMPLEMENTED
     * with the limitation "실제 응답 모양이 관측된 적이 없습니다" — while an approved live read from
     * 2026-08-22 had returned 144 listings with the sale status parsed on every one of them. The
     * ledger reproduced the very failure it exists to prevent, by quoting a stale §4.1 row instead of
     * re-deriving from the evidence index.
     */
    @Test
    void cafe24ProductIsLiveProvenAndNoLongerClaimsAnUnobservedWireShape() {
        for (ProductCapabilityAxis axis : List.of(ProductCapabilityAxis.ACQUISITION,
                ProductCapabilityAxis.READ)) {
            ProductCapability c = PACK.capability("CAFE24", "PRODUCT", axis).orElseThrow();
            assertThat(c.status()).as("%s", c.id()).isEqualTo(ProductCapabilityStatus.SUPPORTED);
            assertThat(c.evidence()).as("%s", c.id()).isEqualTo(ProductEvidence.LIVE_PROVEN);
            assertThat(c.limitations()).as("%s", c.id())
                    .noneSatisfy(l -> assertThat(l).contains("관측된 적이 없습니다"));
        }
        // What is actually missing is a field range, and the row has to keep saying that.
        assertThat(PACK.capability("CAFE24", "PRODUCT", ProductCapabilityAxis.READ).orElseThrow()
                .limitations()).anySatisfy(l -> assertThat(l).contains("옵션조합"));
    }

    /**
     * NAVER 리뷰 초안: the live-observed draft came from the org's own template lane, not from a
     * grounded retrieval, and the row may not spend one proof on the other claim.
     */
    @Test
    void naverReviewDraftClaimsOnlyTheLaneThatWasActuallyObserved() {
        ProductCapability c = PACK.capability("NAVER", "REVIEW", ProductCapabilityAxis.DRAFT)
                .orElseThrow();
        assertThat(c.evidence()).isEqualTo(ProductEvidence.IMPLEMENTED);
        assertThat(c.limitations()).anySatisfy(l -> assertThat(l).contains("아직 관측되지 않았"));
    }

    /** The product-detail knowledge lane is a direction, and no current row may speak for it. */
    @Test
    void theProductDetailKnowledgeLaneIsNotClaimedAsACurrentCapability() {
        assertThat(PACK.capabilities()).allSatisfy(c -> c.sellerFacingNotes()
                .forEach(n -> assertThat(n).as("%s", c.id()).doesNotContain("상세페이지")));
        assertThat(PACK.roadmap()).anySatisfy(
                r -> assertThat(r.id()).isEqualTo("ROADMAP.PRODUCT_DETAIL_KNOWLEDGE"));
    }

    /**
     * NAVER 문의 is three contracts, and the parent row may not speak for all three at once.
     */
    @Test
    void naverInquirySeparatesItsThreeSubtypes() {
        for (ProductCapabilityAxis axis : ProductCapabilityAxis.values()) {
            ProductCapability c = PACK.capability("NAVER", "INQUIRY", axis).orElseThrow();
            assertThat(c.subtypes()).as("%s", c.id())
                    .extracting(ProductCapabilitySubtype::key)
                    .containsExactly("PRODUCT_INQUIRY", "CUSTOMER_INQUIRY", "TALKTALK");
            // 톡톡 is the one a SUPPORTED parent would have swallowed. Because one of the three has
            // no path at all, the summary row is PARTIAL — "we do this for NAVER 문의" is not a
            // sentence this channel can carry — and the subtypes are where the actual answer is.
            assertThat(c.subtypes().get(2).status()).as("%s 톡톡", c.id())
                    .isEqualTo(ProductCapabilityStatus.NOT_SUPPORTED);
            assertThat(c.status()).as("%s 상위 행", c.id())
                    .isEqualTo(ProductCapabilityStatus.PARTIAL);
        }
        // A subtype is not a fifth operating object: it carries no channel, object or axis.
        List<String> fields = List.of(ProductCapabilitySubtype.class.getRecordComponents())
                .stream().map(java.lang.reflect.RecordComponent::getName).toList();
        assertThat(fields).doesNotContain("channel", "object", "axis");
    }

    /** Execution preconditions live as data, on execution rows, and never demote the status. */
    @Test
    void executionPreconditionsAreStructuredAndDoNotChangeTheCapability() {
        ProductCapability cafe24 = PACK.capability("CAFE24", "INQUIRY", ProductCapabilityAxis.EXECUTION)
                .orElseThrow();
        assertThat(cafe24.status()).isEqualTo(ProductCapabilityStatus.SUPPORTED);
        assertThat(cafe24.requirements()).extracting(ProductExecutionRequirement::kind)
                .contains(ProductRequirementKind.WRITE_PERMISSION,
                        ProductRequirementKind.DEPLOYMENT_PREREQUISITE,
                        ProductRequirementKind.VALID_APPROVAL);
        assertThat(PACK.capability("NAVER", "REVIEW", ProductCapabilityAxis.EXECUTION).orElseThrow()
                .requirements()).extracting(ProductExecutionRequirement::kind)
                .contains(ProductRequirementKind.GUIDED_EXECUTION_PREREQUISITE);
        // Only execution rows carry them.
        assertThat(PACK.capabilities()).allSatisfy(c -> {
            if (c.axis() != ProductCapabilityAxis.EXECUTION) {
                assertThat(c.requirements()).as("%s", c.id()).isEmpty();
            }
        });
    }

    /**
     * The other half of "capability is not posture": a capability sentence may not say what is
     * happening right now, and may not name a config key a seller cannot see.
     */
    @Test
    void noCapabilitySentenceAssertsRuntimePostureOrNamesAConfigKey() {
        List<String> sentences = new ArrayList<>();
        PACK.capabilities().forEach(c -> {
            sentences.addAll(c.sellerFacingNotes());
            sentences.addAll(c.limitations());
            c.requirements().forEach(r -> sentences.add(r.description()));
            c.subtypes().forEach(s -> {
                sentences.addAll(s.sellerFacingNotes());
                sentences.addAll(s.limitations());
            });
        });
        PACK.features().forEach(f -> {
            sentences.addAll(f.sellerFacingNotes());
            sentences.addAll(f.limitations());
        });
        assertThat(sentences).isNotEmpty().allSatisfy(s -> assertThat(s)
                .doesNotContain("들어오고 있").doesNotContain("가져오고 있").doesNotContain("돌고 있")
                .doesNotContain("mall.write").doesNotContain("shop_no").doesNotContain("client_ip"));
    }

    /**
     * Manual file upload is the one acquisition path every channel has, and it was absent from the
     * whole ledger — a real alternative that no answer could offer.
     */
    @Test
    void manualFileAcquisitionIsInTheLedger() {
        assertThat(PACK.features()).anySatisfy(f -> {
            assertThat(f.id()).isEqualTo("FEATURE.MANUAL_FILE_ACQUISITION");
            assertThat(f.status()).isEqualTo(ProductCapabilityStatus.SUPPORTED);
        });
    }

    /**
     * The three layers that may not make a capability claim carry no field that could be read as one.
     */
    @Test
    void narrativeDirectionAndRoadmapCannotBeReadAsCapabilities() {
        for (Class<?> type : List.of(ProductNarrative.class, ProductDirection.class,
                ProductRoadmapItem.class)) {
            List<String> fields = List.of(type.getRecordComponents()).stream()
                    .map(java.lang.reflect.RecordComponent::getName).toList();
            assertThat(fields).as("%s", type.getSimpleName())
                    .doesNotContain("mode", "evidence", "axis", "channel", "object");
        }
        // A feature is a capability claim, but never a channel one.
        List<String> featureFields = List.of(ProductFeature.class.getRecordComponents()).stream()
                .map(java.lang.reflect.RecordComponent::getName).toList();
        assertThat(featureFields).doesNotContain("mode", "axis", "channel", "object");
        assertThat(PACK.features()).allSatisfy(f -> assertThat(f.id()).startsWith("FEATURE."));
        assertThat(PACK.directions()).allSatisfy(d -> assertThat(d.id()).startsWith("DIRECTION."));
    }

    // ---- the rules, proven against deliberately broken ledgers --------------------------------

    @Test
    void aDuplicateIdIsRejected() {
        assertThat(violations(List.of(capability("NAVER.INQUIRY.READ", ProductCapabilityAxis.READ,
                        ProductCapabilityStatus.SUPPORTED, ProductCapabilityMode.FULL_READ,
                        ProductEvidence.LIVE_PROVEN),
                capability("NAVER.INQUIRY.READ", ProductCapabilityAxis.READ,
                        ProductCapabilityStatus.SUPPORTED, ProductCapabilityMode.FULL_READ,
                        ProductEvidence.LIVE_PROVEN))))
                .anySatisfy(v -> assertThat(v).contains("중복된 id"));
    }

    @Test
    void aModeThatDoesNotBelongToItsAxisIsRejected() {
        assertThat(violations(List.of(capability("NAVER.INQUIRY.ACQUISITION",
                ProductCapabilityAxis.ACQUISITION, ProductCapabilityStatus.SUPPORTED,
                ProductCapabilityMode.DIRECT_WITH_APPROVAL, ProductEvidence.LIVE_PROVEN))))
                .anySatisfy(v -> assertThat(v).contains("ACQUISITION 축에 쓸 수 없는 mode"));
    }

    @Test
    void supportedWithNoPathIsRejected() {
        assertThat(violations(List.of(capability("NAVER.INQUIRY.READ", ProductCapabilityAxis.READ,
                ProductCapabilityStatus.SUPPORTED, ProductCapabilityMode.NONE,
                ProductEvidence.LIVE_PROVEN))))
                .anySatisfy(v -> assertThat(v).contains("mode=NONE"));
    }

    @Test
    void notSupportedWithAPathIsRejected() {
        assertThat(violations(List.of(capability("NAVER.INQUIRY.READ", ProductCapabilityAxis.READ,
                ProductCapabilityStatus.NOT_SUPPORTED, ProductCapabilityMode.FULL_READ,
                ProductEvidence.DECLARED))))
                .anySatisfy(v -> assertThat(v).contains("NOT_SUPPORTED 인데 mode="));
    }

    /** Writing a capability down is not evidence that it was built. */
    @Test
    void supportedOnDeclaredEvidenceAloneIsRejected() {
        assertThat(violations(List.of(capability("NAVER.INQUIRY.EXECUTION",
                ProductCapabilityAxis.EXECUTION, ProductCapabilityStatus.SUPPORTED,
                ProductCapabilityMode.DIRECT_WITH_APPROVAL, ProductEvidence.DECLARED))))
                .anySatisfy(v -> assertThat(v).contains("IMPLEMENTED 이상의 evidence"));
    }

    /** "Nobody looked" is UNKNOWN, never NOT_SUPPORTED. */
    @Test
    void notSupportedOnUnknownEvidenceIsRejected() {
        assertThat(violations(List.of(capability("NAVER.INQUIRY.EXECUTION",
                ProductCapabilityAxis.EXECUTION, ProductCapabilityStatus.NOT_SUPPORTED,
                ProductCapabilityMode.NONE, ProductEvidence.UNKNOWN))))
                .anySatisfy(v -> assertThat(v).contains("UNKNOWN 입니다"));
    }

    /** An unknown capability has nothing to say to a seller. */
    @Test
    void anUnknownRowMayNotCarryASellerSentence() {
        ProductCapability row = new ProductCapability("NAVER.INQUIRY.EXECUTION", "NAVER", "INQUIRY",
                ProductCapabilityAxis.EXECUTION, ProductCapabilityStatus.UNKNOWN,
                ProductCapabilityMode.NONE, ProductEvidence.UNKNOWN, null,
                List.of("보내 드릴 수 있습니다."), List.of(), List.of(), List.of(), List.of(),
                ProductReviewState.TODO_REVIEW, TODAY);
        assertThat(violations(List.of(row)))
                .anySatisfy(v -> assertThat(v).contains("sellerFacingNotes 를 가질 수 없습니다"));
    }

    @Test
    void aMissingChannelObjectAxisRowIsRejected() {
        assertThat(violations(List.of()))
                .anySatisfy(v -> assertThat(v).contains("누락된 행: NAVER.INQUIRY.ACQUISITION"));
    }

    @Test
    void aRoadmapItemWithoutAQualifierIsRejected() {
        List<String> out = ProductTruthValidator.validate(List.of(), List.of(), List.of(),
                List.of(new ProductRoadmapItem("ROADMAP.X", "제목", ProductRoadmapStatus.EXPLORING,
                        "요약", "  ", List.of(), ProductReviewState.TODO_REVIEW, TODAY)));
        assertThat(out).anySatisfy(v -> assertThat(v).contains("qualifier 는 비워 둘 수 없습니다"));
    }

    @Test
    void aRoadmapQualifierThatDoesNotQualifyIsRejected() {
        List<String> out = ProductTruthValidator.validate(List.of(), List.of(), List.of(),
                List.of(new ProductRoadmapItem("ROADMAP.X", "제목", ProductRoadmapStatus.PLANNED,
                        "요약", "지원합니다.", List.of(), ProductReviewState.TODO_REVIEW, TODAY)));
        assertThat(out).anySatisfy(v -> assertThat(v).contains("한정어 역할을 하지 않습니다"));
    }

    @Test
    void aRuntimePostureSentenceOnACapabilityRowIsRejected() {
        ProductCapability row = new ProductCapability("NAVER.INQUIRY.ACQUISITION", "NAVER", "INQUIRY",
                ProductCapabilityAxis.ACQUISITION, ProductCapabilityStatus.SUPPORTED,
                ProductCapabilityMode.AUTOMATIC, ProductEvidence.LIVE_PROVEN, "테스트",
                List.of("지금 자동으로 문의를 가져오고 있습니다."), List.of(), List.of(), List.of(),
                List.of(), ProductReviewState.TODO_REVIEW, TODAY);
        assertThat(violations(List.of(row)))
                .anySatisfy(v -> assertThat(v).contains("지금의 실행 상태를 단정합니다"));
    }

    @Test
    void aConfigKeyInASellerSentenceIsRejected() {
        ProductCapability row = new ProductCapability("CAFE24.INQUIRY.EXECUTION", "CAFE24", "INQUIRY",
                ProductCapabilityAxis.EXECUTION, ProductCapabilityStatus.SUPPORTED,
                ProductCapabilityMode.DIRECT_WITH_APPROVAL, ProductEvidence.LIVE_PROVEN, "테스트",
                List.of("mall.write_community 동의가 필요합니다."), List.of(), List.of(), List.of(),
                List.of(), ProductReviewState.TODO_REVIEW, TODAY);
        assertThat(violations(List.of(row)))
                .anySatisfy(v -> assertThat(v).contains("내부 설정 이름"));
    }

    /** A precondition on a read would be the runtime overlay creeping back into the ledger. */
    @Test
    void aRequirementOutsideExecutionIsRejected() {
        ProductCapability row = new ProductCapability("NAVER.INQUIRY.READ", "NAVER", "INQUIRY",
                ProductCapabilityAxis.READ, ProductCapabilityStatus.SUPPORTED,
                ProductCapabilityMode.LIMITED_READ, ProductEvidence.LIVE_PROVEN, "테스트",
                List.of("읽습니다."), List.of(), List.of(),
                List.of(new ProductExecutionRequirement(ProductRequirementKind.VALID_APPROVAL, "승인")),
                List.of(), ProductReviewState.TODO_REVIEW, TODAY);
        assertThat(violations(List.of(row)))
                .anySatisfy(v -> assertThat(v).contains("EXECUTION 축에만"));
    }

    /**
     * The over-generalisation rule. A parent that says SUPPORTED over subtypes that disagree has to
     * carry the limitation that says so — otherwise one row speaks for three contracts silently.
     */
    @Test
    void aParentRowThatGeneralisesOverDisagreeingSubtypesIsRejected() {
        ProductCapability row = new ProductCapability("NAVER.INQUIRY.ACQUISITION", "NAVER", "INQUIRY",
                ProductCapabilityAxis.ACQUISITION, ProductCapabilityStatus.SUPPORTED,
                ProductCapabilityMode.AUTOMATIC, ProductEvidence.LIVE_PROVEN, "테스트",
                List.of("가져올 수 있습니다."), List.of(), List.of(), List.of(),
                List.of(subtype("NAVER.INQUIRY.ACQUISITION", "PRODUCT_INQUIRY",
                                ProductCapabilityStatus.SUPPORTED, ProductCapabilityMode.AUTOMATIC,
                                ProductEvidence.LIVE_PROVEN),
                        subtype("NAVER.INQUIRY.ACQUISITION", "TALKTALK",
                                ProductCapabilityStatus.NOT_SUPPORTED, ProductCapabilityMode.NONE,
                                ProductEvidence.DECLARED)),
                ProductReviewState.TODO_REVIEW, TODAY);
        assertThat(violations(List.of(row)))
                .anySatisfy(v -> assertThat(v).contains("과도한 일반화"));
    }

    /** A parent may not claim evidence that none of its subtypes has. */
    @Test
    void aParentRowStrongerThanEverySubtypeIsRejected() {
        ProductCapability row = new ProductCapability("NAVER.INQUIRY.EXECUTION", "NAVER", "INQUIRY",
                ProductCapabilityAxis.EXECUTION, ProductCapabilityStatus.SUPPORTED,
                ProductCapabilityMode.DIRECT_WITH_APPROVAL, ProductEvidence.LIVE_PROVEN, "테스트",
                List.of("보냅니다."), List.of("한계"), List.of(), List.of(),
                List.of(subtype("NAVER.INQUIRY.EXECUTION", "PRODUCT_INQUIRY",
                                ProductCapabilityStatus.SUPPORTED,
                                ProductCapabilityMode.DIRECT_WITH_APPROVAL,
                                ProductEvidence.IMPLEMENTED),
                        subtype("NAVER.INQUIRY.EXECUTION", "CUSTOMER_INQUIRY",
                                ProductCapabilityStatus.SUPPORTED,
                                ProductCapabilityMode.DIRECT_WITH_APPROVAL,
                                ProductEvidence.IMPLEMENTED)),
                ProductReviewState.TODO_REVIEW, TODAY);
        assertThat(violations(List.of(row)))
                .anySatisfy(v -> assertThat(v).contains("어떤 subtype 보다도 강합니다"));
    }

    /** Writing a feature down is not evidence that it was built, either. */
    @Test
    void aFeatureSupportedOnDeclaredEvidenceAloneIsRejected() {
        List<String> out = ProductTruthValidator.validate(List.of(),
                List.of(new ProductFeature("FEATURE.X", "제목", ProductCapabilityStatus.SUPPORTED,
                        ProductEvidence.DECLARED, "적어 뒀다", List.of("합니다."), List.of(), List.of(),
                        ProductReviewState.TODO_REVIEW, TODAY)),
                List.of(), List.of(), List.of(), List.of());
        assertThat(out).anySatisfy(v -> assertThat(v).contains("IMPLEMENTED 이상의 evidence"));
    }

    @Test
    void aDirectionOutsideItsNamespaceIsRejected() {
        List<String> out = ProductTruthValidator.validate(List.of(), List.of(), List.of(), List.of(),
                List.of(new ProductDirection("ROADMAP.X", "제목", "문장", List.of(),
                        ProductReviewState.TODO_REVIEW, TODAY)),
                List.of());
        assertThat(out).anySatisfy(v -> assertThat(v).contains("DIRECTION. 로 시작"));
    }

    @Test
    void loadReportsEveryViolationAtOnceRatherThanTheFirst() {
        assertThatThrownBy(() -> {
            List<String> out = ProductTruthValidator.validate(
                    List.of(capability("NAVER.INQUIRY.READ", ProductCapabilityAxis.READ,
                            ProductCapabilityStatus.SUPPORTED, ProductCapabilityMode.NONE,
                            ProductEvidence.LIVE_PROVEN)),
                    List.of(), List.of(), List.of());
            if (!out.isEmpty()) {
                throw new IllegalStateException(String.join("\n", out));
            }
        }).hasMessageContaining("누락된 행").hasMessageContaining("mode=NONE");
    }

    private static ProductCapabilitySubtype subtype(String parentId, String key,
                                                    ProductCapabilityStatus status,
                                                    ProductCapabilityMode mode,
                                                    ProductEvidence evidence) {
        return new ProductCapabilitySubtype(parentId + "." + key, key, "라벨", status, mode, evidence,
                "테스트", List.of(), List.of());
    }

    private static List<String> violations(List<ProductCapability> capabilities) {
        return ProductTruthValidator.validate(new ArrayList<>(capabilities), List.of(), List.of(), List.of());
    }

    private static ProductCapability capability(String id, ProductCapabilityAxis axis,
                                                ProductCapabilityStatus status,
                                                ProductCapabilityMode mode, ProductEvidence evidence) {
        String[] parts = id.split("\\.");
        return new ProductCapability(id, parts[0], parts[1], axis, status, mode, evidence,
                "테스트", List.of("테스트 문장"), List.of("테스트 한계"), List.of(),
                List.of(), List.of(), ProductReviewState.TODO_REVIEW, TODAY);
    }
}
