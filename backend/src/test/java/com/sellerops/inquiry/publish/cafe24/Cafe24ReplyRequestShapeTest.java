package com.sellerops.inquiry.publish.cafe24;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.inquiry.publish.cafe24.Cafe24ReplyRequestShape.Field;
import com.sellerops.inquiry.publish.cafe24.Cafe24ReplyRequestShape.Requirement;
import com.sellerops.inquiry.publish.cafe24.Cafe24ReplyRequestShape.Sourcing;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The request audit is only worth holding if it stays tied to the document it was read off, and
 * refuses to declare itself ready on its own.
 */
class Cafe24ReplyRequestShapeTest {

    private static final Path CONTRACT =
            Path.of("..", "docs", "vendor", "cafe24-admin-api", "get-boards-articles.md");

    @Test
    @DisplayName("계약 사본이 저장소에 있고, 이 감사가 가리키는 endpoint를 담고 있다")
    void theVendoredContractIsPresent() throws Exception {
        assertThat(Files.exists(CONTRACT))
                .describedAs("공식 계약 사본이 없으면 이 감사는 기억에 근거한 것이 된다")
                .isTrue();
        String text = Files.readString(CONTRACT);
        assertThat(text).contains("POST /api/v2/admin/boards/{board_no}/articles");
        assertThat(text).contains("reply_article_no");
    }

    @Test
    @DisplayName("계약이 필수라 한 다섯 필드는 감사에서도 필수다")
    void requiredFieldsMatchTheContract() {
        for (String name : new String[] {"board_no", "writer", "title", "content", "client_ip"}) {
            assertThat(Cafe24ReplyRequestShape.field(name))
                    .describedAs(name)
                    .isPresent()
                    .get().extracting(Field::requirement)
                    .isEqualTo(Requirement.REQUIRED);
        }
    }

    @Test
    @DisplayName("글을 답변으로 만드는 필드는 보내며, 의미가 증명되지 않은 필드는 보내지 않는다")
    void theReplyBindingIsSentAndTheUnprovenActorIsNot() {
        assertThat(Cafe24ReplyRequestShape.field("reply_article_no")).isPresent()
                .get().extracting(Field::requirement).isEqualTo(Requirement.OPTIONAL_USED);
        assertThat(Cafe24ReplyRequestShape.field("reply_user_id")).isPresent()
                .get().extracting(Field::requirement).isEqualTo(Requirement.NOT_USED);
    }

    @Test
    @DisplayName("이 endpoint가 받지 않는 이름은 감사에도 없다")
    void anUnknownFieldIsNotInvented() {
        assertThat(Cafe24ReplyRequestShape.field("reply_content")).isEmpty();
        assertThat(Cafe24ReplyRequestShape.field("answer")).isEmpty();
    }

    @Test
    @DisplayName("WRITE는 아직 준비되지 않았고, 그 이유는 열거된다")
    void writeIsNotReadyAndSaysWhy() {
        assertThat(Cafe24ReplyRequestShape.writeReady()).isFalse();
        assertThat(Cafe24ReplyRequestShape.blockers()).extracting(Field::name)
                .contains("writer", "title", "client_ip", "reply_status");
    }

    @Test
    @DisplayName("소싱할 수 없는 필드는 절대 보유로 표시되지 않는다 — 감사는 분류이지 요청 본문이 아니다")
    void anUnsourceableFieldIsNeverMarkedHeld() {
        assertThat(Cafe24ReplyRequestShape.fields()).isNotEmpty().allSatisfy(f -> {
            assertThat(f.sourcing()).isNotNull();
            if (f.blocksWrite()) {
                assertThat(f.sourcing()).isNotIn(Sourcing.HELD, Sourcing.CONNECTION,
                        Sourcing.CONTRACT_DOCUMENTED);
            }
        });
    }
}
