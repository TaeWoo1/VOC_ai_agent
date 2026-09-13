package com.sellerops.connector.cafe24;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import java.io.IOException;

/**
 * <b>How many files an attachment array held — and a type that cannot hold anything else.</b>
 *
 * <p>Cafe24's board-article response carries {@code attach_file_urls}, an array of
 * {@code {name, url}} objects. Media Presence Projection v1 projects its LENGTH so a review can say
 * whether it has photos; it projects nothing else, and this type is how that is enforced rather than
 * merely intended. An {@code int} is the only state here, so there is no field anywhere in the
 * connector for a filename or a URL to be assigned to, logged from, or persisted by accident later —
 * which is the rule {@code Cafe24BoardArticleRow} already states for the buyer keys beside it.
 *
 * <p><b>The deserializer counts tokens and never builds a tree.</b> It walks the array with
 * {@code skipChildren()}, so the {@code url} strings are not even materialized as Java objects on
 * their way past. Binding the array to a {@code List<Object>} would have been shorter and would have
 * left every URL sitting in a heap object for the duration of the parse.
 *
 * <p><b>A non-array is zero, not a failure.</b> This is a diagnosticless projection on the routine
 * collection path: an unexpected shape must not take down a sweep that is otherwise reading reviews
 * correctly. Absence of the key is a different thing again — it yields a null field on the row, which
 * travels to {@code media_count_observed = false} and means «the response did not say».
 */
@JsonDeserialize(using = AttachmentCount.Deserializer.class)
public record AttachmentCount(int value) {

    static final class Deserializer extends JsonDeserializer<AttachmentCount> {
        @Override
        public AttachmentCount deserialize(JsonParser p, DeserializationContext ctx) throws IOException {
            if (p.currentToken() != JsonToken.START_ARRAY) {
                p.skipChildren();
                return new AttachmentCount(0);
            }
            int count = 0;
            while (p.nextToken() != JsonToken.END_ARRAY) {
                count++;
                p.skipChildren();
            }
            return new AttachmentCount(count);
        }
    }
}
