package com.sellerops.operationscase;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.operationscase.dto.CustomerOperationsHomeView;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>The moment between «the seller decided» and «the record says what happened» has a name.</b>
 *
 * <p>Before this, a case left 「직접 판단하실 일」 the instant the seller acted and appeared nowhere until the
 * canonical verification landed. On screen that is indistinguishable from the case having been dropped — the one
 * reading that is certainly false. So the open case now shows in the area that already exists, with one word.
 *
 * <p>What it must never do is close the gap by guessing. «보냈습니다» and «처리 완료» are the execution record's
 * sentences and it has not said them yet; this state says only what Reviewnary itself is doing, which is reading.
 * These assertions hold that line in the view's own shape and in the seller-facing wording.
 */
class CustomerOperationsVerifyingStateTest {

    private static final Path SERVICE =
            Paths.get("src/main/java/com/sellerops/operationscase/CustomerOperationsHomeService.java");
    private static final Path COPY = Paths.get("../frontend/src/lib/customerOperations.ts");

    private static String code(Path path) throws IOException {
        return Files.readString(path).replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");
    }

    @Test
    @DisplayName("a row can say it is being verified without that being a third judgement")
    void verifyingIsItsOwnFactNotADisposition() {
        CustomerOperationsHomeView.HandledRow verifying = new CustomerOperationsHomeView.HandledRow(
                java.util.UUID.randomUUID(), "INQUIRY", "카페24", "교환 문의", null,
                CaseDisposition.NEEDS_DECISION.name(), CaseDecider.AGENT.name(), "답변이 필요합니다", null, true,
                "/inquiries/x");

        assertThat(verifying.verifying()).isTrue();
        assertThat(verifying.disposition())
                .as("what Reviewnary judged is unchanged; only the reading of the result is new")
                .isEqualTo(CaseDisposition.NEEDS_DECISION.name());
    }

    @Test
    @DisplayName("an empty home states zero verifying rather than omitting the fact")
    void unavailableHomeCarriesTheCount() {
        CustomerOperationsHomeView.Handled none = CustomerOperationsHomeView.unavailable(120).handled();

        assertThat(none.verifying()).isZero();
        assertThat(none.rows()).isEmpty();
    }

    @Test
    @DisplayName("the population is «the seller acted, the record has not settled» — and it is still an open case")
    void theServiceDerivesItFromTheCanonicalRecord() throws IOException {
        String service = code(SERVICE);

        assertThat(service)
                .as("only open cases: a closed one belongs to the reconciler's own resolution, not to this state")
                .contains("OperationsCaseStatus.PREPARED");
        assertThat(service)
                .as("the seller had something to decide, and the canonical record no longer says they must")
                .contains("CaseDisposition.NEEDS_DECISION")
                .contains("!stillWaitingOnCanonicalRecord(c)");
        assertThat(service)
                .as("the gate is read-only: this screen never writes a case's status")
                .doesNotContain(".setStatus(");
    }

    @Test
    @DisplayName("the seller-facing words claim nothing the execution record has not said")
    void theCopyNeverClaimsDelivery() throws IOException {
        String copy = code(COPY);

        assertThat(copy).contains("승인한 작업의 처리 결과를 확인하고 있습니다");
        assertThat(copy).contains("처리 확인 중");
        for (String forbidden : List.of("보냈습니다", "전송했습니다", "처리 완료", "처리했습니다", "등록했습니다")) {
            assertThat(copy).as("this state may not say %s — the execution record owns that sentence", forbidden)
                    .doesNotContain(forbidden);
        }
    }
}
