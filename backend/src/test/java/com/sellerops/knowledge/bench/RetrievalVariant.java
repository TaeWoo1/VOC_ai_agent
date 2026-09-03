package com.sellerops.knowledge.bench;

import com.sellerops.knowledge.KnowledgeRetriever;
import com.sellerops.knowledge.KnowledgeTopic;
import com.sellerops.knowledge.KnowledgeText;
import com.sellerops.knowledge.RetrievalQuery;
import com.sellerops.knowledge.bench.BenchmarkFixture.Corpus;
import com.sellerops.knowledge.bench.BenchmarkFixture.Passage;
import com.sellerops.knowledge.bench.BenchmarkFixture.Query;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/** One way of answering «which passages of this corpus ground this question». */
public interface RetrievalVariant {

    /** How many passages reach the drafter in production. */
    int MAX_PASSAGES = 4;

    String name();

    List<Passage> retrieve(Corpus corpus, Query query);

    /**
     * <b>The production path, exactly as a lane runs it.</b>
     *
     * <p>Defined in one place ({@link RetrievalArm#shipped()}) so the sweep's control arm and the
     * regression guard cannot drift apart: the same ranker, the same thresholds, the same topic
     * refusals, the same cap, plus the two things Knowledge Retrieval Quality v2 added — the
     * customer's sentence restated before it is embedded, and the refusal-only evidence judgement
     * after ranking. What the fixture supplies is the one thing a test may not buy from a vendor: the
     * vectors and the two model outputs, cached and checked in.
     */
    static RetrievalVariant production() {
        return RetrievalArm.shipped();
    }

    /**
     * The lexical path, exactly: the {@link RetrievalQuery} candidate ladder, the unchanged
     * {@link KnowledgeRetriever} gates, the {@link KnowledgeTopic} applicability refusal the lane
     * services apply after ranking, and the same cap.
     */
    static RetrievalVariant lexicalBaseline() {
        return new RetrievalVariant() {
            @Override
            public String name() {
                return "LEXICAL (shipped)";
            }

            @Override
            public List<Passage> retrieve(Corpus corpus, Query query) {
                List<KnowledgeRetriever.Candidate<Passage>> candidates = corpus.passages().stream()
                        .map(p -> new KnowledgeRetriever.Candidate<>(p, p.searchable())).toList();
                RetrievalQuery question = RetrievalQuery.ofText(query.text());
                Set<KnowledgeTopic> asked = KnowledgeTopic.of(question.text());
                for (RetrievalQuery.Candidate form : question.candidates()) {
                    List<Passage> found = new ArrayList<>();
                    for (KnowledgeRetriever.Hit<Passage> hit
                            : KnowledgeRetriever.rank(form.text(), candidates, corpus.subject())) {
                        if (!KnowledgeTopic.applicable(asked, KnowledgeTopic.of(hit.ref().title()))) {
                            continue;
                        }
                        found.add(hit.ref());
                    }
                    if (!found.isEmpty()) {
                        return found.size() > MAX_PASSAGES ? found.subList(0, MAX_PASSAGES) : found;
                    }
                }
                return List.of();
            }
        };
    }
}
