package com.sellerops.knowledge.spine.dto;

import com.sellerops.knowledge.spine.KnowledgeEntry;
import com.sellerops.knowledge.spine.SourceRef;
import java.util.List;

/** An entry, read fresh from its raw source, with each of its refs followed back to the row it names. */
public record KnowledgeTraceView(KnowledgeEntry entry, List<ResolvedRef> sources) {

    public record ResolvedRef(SourceRef ref, boolean resolved) {
    }
}
