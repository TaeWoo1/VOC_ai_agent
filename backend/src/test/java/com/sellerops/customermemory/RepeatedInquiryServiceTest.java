package com.sellerops.customermemory;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.customermemory.dto.RepeatedInquiryView;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * 반복 문의 detection — the capability the audit found had no implementation at all
 * ({@code docs/demo_baseline_recovery_audit_2026-08-21.md} §2.3(c), gap I).
 *
 * <p>The properties worth pinning are the ones that stop this from manufacturing a pattern: a single
 * occurrence is not a repeat; an unclassifiable inquiry does not group with other unclassifiable ones;
 * a review is not an inquiry; and the reference date really pins the window, so the same question
 * asked twice gets the same answer.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class RepeatedInquiryServiceTest {

    @Autowired CustomerMemoryEntryRepository entries;

    private final UUID org = UUID.randomUUID();
    private RepeatedInquiryService service;

    @BeforeEach
    void setUp() {
        service = new RepeatedInquiryService(entries);
    }

    @Test
    @DisplayName("two inquiries with the same signature are a repeat; one is not")
    void twoIsARepeatOneIsNot() {
        entry(CustomerMemoryKind.INQUIRY, "접착:탈락", "품질", false, "2026-08-10");
        entry(CustomerMemoryKind.INQUIRY, "접착:탈락", "품질", true, "2026-08-15");
        entry(CustomerMemoryKind.INQUIRY, "색상:불일치", "색상", false, "2026-08-16");

        List<RepeatedInquiryView> repeats = signatureRows(service.repeats(org, LocalDate.parse("2026-08-21"), 28));

        assertThat(repeats).extracting(RepeatedInquiryView::key).containsExactly("접착:탈락");
        RepeatedInquiryView row = repeats.get(0);
        assertThat(row.occurrences()).isEqualTo(2);
        assertThat(row.answeredOccurrences())
                .as("a repeat that is fully answered is a documentation gap; one that is not is a backlog")
                .isEqualTo(1);
        assertThat(row.labelKo()).as("the label comes from vocabulary, never from a body").isEqualTo("접착 탈락");
        assertThat(row.firstSeenOn()).isEqualTo(LocalDate.parse("2026-08-10"));
        assertThat(row.lastSeenOn()).isEqualTo(LocalDate.parse("2026-08-15"));
    }

    @Test
    @DisplayName("기타 — the analyzer's 'fits nothing' verdict — is never reported as a repeat")
    void theFallbackCategoryIsNotARepeat() {
        // Found on real data 2026-08-21: the demo org's largest "repeat" was 기타 with 1,777
        // occurrences — every inquiry the vocabulary could not place, printed to a seller as a pattern.
        // 기타 is a statement about the classifier, not about the customers, so it is excluded for the
        // same reason a null topic is.
        for (int i = 0; i < 5; i++) {
            entry(CustomerMemoryKind.INQUIRY, null, "기타", false, "2026-08-1" + i);
        }
        entry(CustomerMemoryKind.INQUIRY, null, "배송", false, "2026-08-10");
        entry(CustomerMemoryKind.INQUIRY, null, "배송", false, "2026-08-11");

        List<RepeatedInquiryView> rows = service.repeats(org, LocalDate.parse("2026-08-21"), 28);

        assertThat(rows).extracting(RepeatedInquiryView::key)
                .as("a real topic repeats; the fallback bucket does not")
                .containsExactly("배송")
                .doesNotContain("기타");
    }

    @Test
    @DisplayName("unclassified inquiries never group with each other")
    void unclassifiedNeverGroups() {
        entry(CustomerMemoryKind.INQUIRY, null, null, false, "2026-08-10");
        entry(CustomerMemoryKind.INQUIRY, null, null, false, "2026-08-11");
        entry(CustomerMemoryKind.INQUIRY, null, null, false, "2026-08-12");

        assertThat(service.repeats(org, LocalDate.parse("2026-08-21"), 28))
                .as("letting 'we could not classify it' form the largest group would let a gap in "
                        + "extraction manufacture a 반복 문의 verdict")
                .isEmpty();
    }

    @Test
    @DisplayName("reviews are not inquiries, however many of them say the same thing")
    void reviewsAreNotInquiries() {
        entry(CustomerMemoryKind.REVIEW, "접착:탈락", "품질", false, "2026-08-10");
        entry(CustomerMemoryKind.REVIEW, "접착:탈락", "품질", false, "2026-08-11");

        assertThat(service.repeats(org, LocalDate.parse("2026-08-21"), 28))
                .as("repeated REVIEWS are what the issue memory already owns; this axis is questions")
                .isEmpty();
    }

    @Test
    @DisplayName("the window is real: occurrences outside it do not count")
    void theWindowIsReal() {
        entry(CustomerMemoryKind.INQUIRY, "배송:지연", "배송", false, "2026-08-18");
        entry(CustomerMemoryKind.INQUIRY, "배송:지연", "배송", false, "2026-05-01");

        assertThat(signatureRows(service.repeats(org, LocalDate.parse("2026-08-21"), 28)))
                .as("one occurrence inside a 28-day window is not a repeat, whatever happened in May")
                .isEmpty();
        assertThat(signatureRows(service.repeats(org, LocalDate.parse("2026-08-21"), 200)))
                .as("widen the window and the same data is a repeat — the window is the judgement")
                .hasSize(1);
    }

    @Test
    @DisplayName("the same reference date always gives the same answer")
    void theReferenceDatePinsTheAnswer() {
        entry(CustomerMemoryKind.INQUIRY, "접착:탈락", "품질", false, "2026-08-10");
        entry(CustomerMemoryKind.INQUIRY, "접착:탈락", "품질", false, "2026-08-15");

        List<RepeatedInquiryView> first = service.repeats(org, LocalDate.parse("2026-08-21"), 28);
        List<RepeatedInquiryView> second = service.repeats(org, LocalDate.parse("2026-08-21"), 28);

        assertThat(second).isEqualTo(first);
    }

    @Test
    @DisplayName("another org's repeats are not this org's repeats")
    void repeatsAreOrgScoped() {
        UUID other = UUID.randomUUID();
        CustomerMemoryEntry a = entry(CustomerMemoryKind.INQUIRY, "접착:탈락", "품질", false, "2026-08-10");
        CustomerMemoryEntry b = entry(CustomerMemoryKind.INQUIRY, "접착:탈락", "품질", false, "2026-08-15");
        a.setOrgId(other);
        b.setOrgId(other);
        entries.save(a);
        entries.save(b);

        assertThat(service.repeats(org, LocalDate.parse("2026-08-21"), 28)).isEmpty();
    }

    private List<RepeatedInquiryView> signatureRows(List<RepeatedInquiryView> all) {
        return all.stream().filter(v -> RepeatedInquiryView.AXIS_SIGNATURE.equals(v.axis())).toList();
    }

    private CustomerMemoryEntry entry(CustomerMemoryKind kind, String signature, String topic,
                                      boolean answered, String day) {
        CustomerMemoryEntry e = new CustomerMemoryEntry();
        e.setOrgId(org);
        e.setEntryKind(kind);
        e.setSourceId(UUID.randomUUID());
        e.setTopic(topic);
        e.setSignatureKey(signature);
        e.setOccurredOn(LocalDate.parse(day));
        e.setAnswered(answered);
        return entries.save(e);
    }
}
