package com.sellerops.operationscase.investigation;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * What the investigator is told about a review's photos (Customer Ops Demo Closure v1): a photo a vision model looked
 * at is described and citable; a photo nobody looked at is named as not seen and never described; a review that only
 * reported a count says only that.
 */
class CaseInvestigationMediaTest {

    private static String lines(CaseInvestigationTools.ReviewMediaFacts media, Set<String> refs) {
        StringBuilder text = new StringBuilder();
        CaseInvestigator.appendMedia(text, refs, media);
        return text.toString();
    }

    @Test
    @DisplayName("an inspected photo is described and citable; an uninspected one is only «not seen»")
    void inspectedAndNotSeen() {
        Set<String> refs = new LinkedHashSet<>();
        String text = lines(new CaseInvestigationTools.ReviewMediaFacts(2, true, List.of(
                new CaseInvestigationTools.MediaFact(1, "IMAGE", true, "모서리가 깨진 흰색 몰딩", "YES",
                        "한쪽 모서리가 깨져 있습니다", null),
                new CaseInvestigationTools.MediaFact(2, "IMAGE", false, null, null, null, "CAPABILITY_OFF"))), refs);

        assertThat(text).contains("[m1] 첨부 사진 1: 사진에 보이는 것 — 모서리가 깨진 흰색 몰딩 · 리뷰 글의 문제가 사진에 보임");
        assertThat(text).contains("[m2] 첨부 사진 2: 보지 못했습니다(사진 확인 기능이 꺼져 있음).");
        assertThat(refs).containsExactly("m1", "m2");
        assertThat(text.lines().filter(l -> l.startsWith("[m2]")).findFirst().orElseThrow())
                .doesNotContain("보이는 것");
    }

    @Test
    @DisplayName("a count without addresses says only that photos exist")
    void aCountIsNotASighting() {
        Set<String> refs = new LinkedHashSet<>();
        String text = lines(new CaseInvestigationTools.ReviewMediaFacts(3, true, List.of()), refs);
        assertThat(text).isEqualTo("[media] 첨부 사진·영상 3개가 있다는 것만 확인했고, 사진 자체는 보지 못했습니다.\n");
        assertThat(refs).containsExactly("media");

        Set<String> none = new LinkedHashSet<>();
        assertThat(lines(new CaseInvestigationTools.ReviewMediaFacts(0, true, List.of()), none)).isEmpty();
        assertThat(lines(new CaseInvestigationTools.ReviewMediaFacts(0, false, List.of()), none))
                .as("an unobserved count claims nothing").isEmpty();
    }
}
