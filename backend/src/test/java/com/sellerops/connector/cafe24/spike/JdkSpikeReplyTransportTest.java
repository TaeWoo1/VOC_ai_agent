package com.sellerops.connector.cafe24.spike;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.connector.cafe24.spike.SpikeReplyTransport.ArticleObservation;
import com.sellerops.connector.cafe24.spike.SpikeReplyTransport.CommentObservation;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Pure-helper coverage for the live transport — the comment write envelope and the
 * defensive response parsers — without touching the network.
 */
class JdkSpikeReplyTransportTest {

    @Test
    void commentEnvelopeWrapsFieldsInRequestObject() {
        String json = JdkSpikeReplyTransport.buildCommentEnvelope("본문", "SellerOps 연결점검", "pw12345");
        assertThat(json).contains("\"shop_no\":1");
        assertThat(json).contains("\"request\":");
        assertThat(json).contains("\"content\":\"본문\"");
        assertThat(json).contains("\"writer\":\"SellerOps 연결점검\"");
        assertThat(json).contains("\"password\":\"pw12345\"");
    }

    @Test
    void parseArticleReadsReplyStatusFromArticleObject() {
        String body = "{\"article\":{\"article_no\":123,\"reply_status\":\"N\",\"title\":\"x\"}}";
        ArticleObservation a = JdkSpikeReplyTransport.parseArticle(body, 6);
        assertThat(a.articleNo()).isEqualTo(123);
        assertThat(a.boardNo()).isEqualTo(6);
        assertThat(a.rawReplyStatus()).isEqualTo("N");
    }

    @Test
    void parseArticleFallsBackToArticlesArray() {
        String body = "{\"articles\":[{\"article_no\":9,\"reply_status\":\"C\"}]}";
        ArticleObservation a = JdkSpikeReplyTransport.parseArticle(body, 6);
        assertThat(a.articleNo()).isEqualTo(9);
        assertThat(a.rawReplyStatus()).isEqualTo("C");
    }

    @Test
    void parseArticleFailsClosedOnEmptyBody() {
        assertThatThrownBy(() -> JdkSpikeReplyTransport.parseArticle("{}", 6))
                .isInstanceOf(SpikeTransportException.class);
    }

    @Test
    void parseCommentsReadsCommentNoAndWriter() {
        String body = "{\"comments\":[{\"comment_no\":1,\"writer\":\"a\"},{\"comment_no\":2,\"writer\":\"b\"}]}";
        List<CommentObservation> comments = JdkSpikeReplyTransport.parseComments(body);
        assertThat(comments).hasSize(2);
        assertThat(comments.get(0).commentNo()).isEqualTo(1);
        assertThat(comments.get(1).writer()).isEqualTo("b");
    }

    @Test
    void parseCommentsEmptyListWhenNoComments() {
        assertThat(JdkSpikeReplyTransport.parseComments("{\"comments\":[]}")).isEmpty();
    }

    @Test
    void parseCreatedCommentReadsSingleComment() {
        String body = "{\"comment\":{\"comment_no\":555,\"writer\":\"SellerOps 연결점검\"}}";
        CommentObservation c = JdkSpikeReplyTransport.parseCreatedComment(body);
        assertThat(c.commentNo()).isEqualTo(555);
    }

    @Test
    void parseCreatedCommentFailsClosedOnEmpty() {
        assertThatThrownBy(() -> JdkSpikeReplyTransport.parseCreatedComment("{}"))
                .isInstanceOf(SpikeTransportException.class);
    }

    @Test
    void urisTargetTheAdminCommentsEndpoint() {
        assertThat(JdkSpikeReplyTransport.commentsUri("teststore", 6, 42).toString())
                .isEqualTo("https://teststore.cafe24api.com/api/v2/admin/boards/6/articles/42/comments");
        assertThat(JdkSpikeReplyTransport.articleUri("teststore", 6, 42).toString())
                .isEqualTo("https://teststore.cafe24api.com/api/v2/admin/boards/6/articles/42");
    }

    @Test
    void mallIdShapeIsValidatedBeforeAnyUri() {
        assertThatThrownBy(() -> JdkSpikeReplyTransport.commentsUri("bad host!", 6, 42))
                .isInstanceOf(SpikeTransportException.class);
    }
}
