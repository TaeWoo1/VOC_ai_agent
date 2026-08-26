package com.sellerops.product.detail.image;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Association and authority — the deterministic half, and the half that decides whether the
 * 2026-08-26 defect can happen again.
 *
 * <p>That defect was a confident answer resting on an association nobody made. Every case here is
 * about refusing to make one.
 */
class ImageFactAuthorityTest {

    private static final List<String> OPTIONS = List.of("1호 (16x10mm)", "2호 (22x10mm)", "3호 / 화이트");

    private static ExtractedImageFacts facts(ExtractedImageFacts.Fact... rows) {
        return new ExtractedImageFacts(List.of(rows));
    }

    private static ExtractedImageFacts.Fact fact(String label, String attribute, String value) {
        return new ExtractedImageFacts.Fact(label, attribute, value);
    }

    @Test
    @DisplayName("exact whole-token match associates; a bare number does not")
    void exactMatchOnly() {
        assertThat(ImageFactAssociation.match("2호 (22x10mm)", OPTIONS)).contains("2호 (22x10mm)");
        // The defect in one assertion. "2" is not "2호", and the reasoning that would connect them —
        // "the label starts with the same digit" — is exactly the inference this lane forbids.
        assertThat(ImageFactAssociation.match("2", OPTIONS)).isEmpty();
        assertThat(ImageFactAssociation.match("22x10", OPTIONS)).isEmpty();
        assertThat(ImageFactAssociation.match("2호", OPTIONS))
                .as("a substring of one option name is not that option")
                .isEmpty();
    }

    @Test
    @DisplayName("an axis of a multi-axis option is a whole token; a fragment of one is not")
    void axisTokensMatch() {
        assertThat(ImageFactAssociation.match("3호", OPTIONS)).contains("3호 / 화이트");
        assertThat(ImageFactAssociation.match("화이트", OPTIONS)).contains("3호 / 화이트");
        assertThat(ImageFactAssociation.match("화이", OPTIONS)).isEmpty();
    }

    @Test
    @DisplayName("full-width digits are the same 규격 typed on another keyboard")
    void normalizationIsEncodingOnly() {
        assertThat(ImageFactAssociation.match("２호 / 화이트", List.of("2호 / 화이트")))
                .contains("2호 / 화이트");
        // A unit is not an encoding difference, and dropping one is how "2" starts matching "2호".
        assertThat(ImageFactAssociation.match("22", List.of("22mm"))).isEmpty();
    }

    @Test
    @DisplayName("an ambiguous label names no 규격 at all")
    void ambiguityRefuses() {
        assertThat(ImageFactAssociation.match("공통", List.of("공통 / 화이트", "공통 / 블랙"))).isEmpty();
    }

    @Test
    @DisplayName("rule A — a value with no 규격 governing it is refused")
    void ruleARefusesUnlabelledValues() {
        ImageFactAuthority.Finalized finalized = ImageFactAuthority.decide(
                List.of(new ImageFactAuthority.ImageFacts("sha-a",
                        facts(fact(null, "수용 가닥수", "3~4가닥")))), OPTIONS);

        assertThat(finalized.judged()).singleElement()
                .extracting(ImageFactAuthority.Judged::verdict)
                .isEqualTo(ImageFactAuthority.Verdict.REFUSED_NO_SPEC_LABEL);
        assertThat(finalized.accepted()).isEmpty();
    }

    @Test
    @DisplayName("rule B — a label no stored 규격 matches is unresolved, kept, and never quoted")
    void ruleBLeavesUnmatchedLabelsUnresolved() {
        ImageFactAuthority.Finalized finalized = ImageFactAuthority.decide(
                List.of(new ImageFactAuthority.ImageFacts("sha-a",
                        facts(fact("특대형", "수용 가닥수", "8가닥")))), OPTIONS);

        assertThat(finalized.countOf(ImageFactAuthority.Verdict.UNRESOLVED_NO_EXACT_VARIANT))
                .isEqualTo(1);
        assertThat(finalized.accepted()).isEmpty();
    }

    @Test
    @DisplayName("rule C — two pictures contradicting each other refuse BOTH, across images")
    void ruleCRefusesBothSidesOfAContradiction() {
        ImageFactAuthority.Finalized finalized = ImageFactAuthority.decide(List.of(
                new ImageFactAuthority.ImageFacts("sha-a",
                        facts(fact("1호 (16x10mm)", "수용 가닥수", "2가닥"))),
                new ImageFactAuthority.ImageFacts("sha-b",
                        facts(fact("1호 (16x10mm)", "수용 가닥수", "4가닥")))), OPTIONS);

        // Not "the newest wins" and not "the majority wins": an old table left below a new one is the
        // ordinary case on a 상세페이지, and we do not know which of the two it is.
        assertThat(finalized.accepted()).isEmpty();
        assertThat(finalized.countOf(ImageFactAuthority.Verdict.REFUSED_CONFLICTING_VALUE))
                .isEqualTo(2);
    }

    @Test
    @DisplayName("rule D — exact 규격, no contradiction, and only then may it be stated")
    void ruleDAccepts() {
        ImageFactAuthority.Finalized finalized = ImageFactAuthority.decide(List.of(
                new ImageFactAuthority.ImageFacts("sha-a",
                        facts(fact("1호 (16x10mm)", "수용 가닥수", "2가닥"),
                                fact("2호 (22x10mm)", "수용 가닥수", "4가닥")))), OPTIONS);

        assertThat(finalized.accepted()).hasSize(2);
        assertThat(finalized.accepted()).allSatisfy(judged ->
                assertThat(judged.matchedOptionName()).isNotNull());
    }

    @Test
    @DisplayName("the same value stated twice is agreement, not a contradiction")
    void repeatedAgreementIsNotAConflict() {
        ImageFactAuthority.Finalized finalized = ImageFactAuthority.decide(List.of(
                new ImageFactAuthority.ImageFacts("sha-a",
                        facts(fact("1호 (16x10mm)", "수용 가닥수", "2가닥"))),
                new ImageFactAuthority.ImageFacts("sha-b",
                        facts(fact("1호 (16x10mm)", "수용 가닥수", "2가닥")))), OPTIONS);

        assertThat(finalized.accepted()).hasSize(2);
    }

    @Test
    @DisplayName("with no stored 규격 nothing can be accepted — which is why variants come first")
    void noVariantsMeansNothingIsQuotable() {
        ImageFactAuthority.Finalized finalized = ImageFactAuthority.decide(
                List.of(new ImageFactAuthority.ImageFacts("sha-a",
                        facts(fact("1호", "수용 가닥수", "2가닥")))), List.of());

        assertThat(finalized.accepted()).isEmpty();
    }
}
