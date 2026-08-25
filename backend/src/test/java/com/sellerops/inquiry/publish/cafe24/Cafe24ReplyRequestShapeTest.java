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
    @DisplayName("요청 본문의 모든 칸이 출처 규칙을 갖는다 — 그러나 그것이 보낼 수 있다는 뜻은 아니다")
    void theRequestShapeIsSettledButThatIsNotPermissionToSend() {
        assertThat(Cafe24ReplyRequestShape.requestShapeSettled()).isTrue();
        assertThat(Cafe24ReplyRequestShape.blockers()).isEmpty();
        // The one field a deployment still has to state. It is not a default and not derivable.
        assertThat(Cafe24ReplyRequestShape.field("client_ip")).isPresent()
                .get().extracting(Field::sourcing).isEqualTo(Sourcing.DEPLOYMENT_CONFIGURED);
    }

    @Test
    @DisplayName("관측이 답한 칸은 관측이 답했다고 적혀 있다 — writer·title·member_id")
    void theObservedFieldsSayWhereTheirValueComesFrom() {
        assertThat(Cafe24ReplyRequestShape.field("writer")).isPresent()
                .get().extracting(Field::sourcing).isEqualTo(Sourcing.CONNECTION);
        assertThat(Cafe24ReplyRequestShape.field("member_id")).isPresent()
                .get().extracting(Field::sourcing).isEqualTo(Sourcing.CONNECTION);
        assertThat(Cafe24ReplyRequestShape.field("title")).isPresent()
                .get().extracting(Field::sourcing).isEqualTo(Sourcing.HELD);
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
