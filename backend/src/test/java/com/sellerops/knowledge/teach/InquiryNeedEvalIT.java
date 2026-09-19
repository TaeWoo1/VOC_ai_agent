package com.sellerops.knowledge.teach;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.draft.InquiryEvidenceRetriever;
import com.sellerops.inquiry.draft.InquiryKnowledgeAssessor;
import com.sellerops.knowledge.KnowledgeScope;
import com.sellerops.knowledge.memory.AnswerMemory;
import com.sellerops.knowledge.memory.AnswerMemoryRepository;
import com.sellerops.order.fact.OrderFactLookup;
import com.sellerops.product.ProductVariantRepository;
import com.sellerops.product.catalogue.CatalogueInvestigator;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

/**
 * <b>Inquiry Need Eval v1 — the L3 observation</b> ({@code docs/inquiry_need_eval_v1.md}). Not a product test.
 *
 * <p>For every question of an eval dataset it runs the production {@link InquiryKnowledgeAssessor} — the one assessment
 * the investigation and the draft both read — with {@link OrderFactLookup#STORED_ONLY}, and writes what it observed:
 * the basis, the cited current passages, the past answers the memory lane offered, the precedent and whether the Case
 * fence would show it, the catalogue statements and the 규격 verdict. <b>Ids and closed tokens only</b>: no customer
 * sentence is written, and a real question is read by id from the snapshot, never from the dataset.
 *
 * <p>Gated by {@code RUN_INQUIRY_NEED_EVAL=true} against a disposable clone. The method rolls back; the assessor is
 * read-only. It refuses to run when {@code EVAL_ARM} says the knowledge capabilities are off but the process has one on
 * — an arm label must describe the process that produced it.
 */
@EnabledIfEnvironmentVariable(named = "RUN_INQUIRY_NEED_EVAL", matches = "true")
@SpringBootTest
class InquiryNeedEvalIT {

    @Autowired InquiryKnowledgeAssessor assessor;
    @Autowired InquiryRepository inquiries;
    @Autowired AnswerMemoryRepository memories;
    @Autowired ProductVariantRepository variants;
    @Autowired JdbcTemplate jdbc;
    @Autowired Environment env;

    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    @Transactional
    void observe() throws Exception {
        UUID org = UUID.fromString(System.getenv("EVAL_ORG"));
        String arm = System.getenv("EVAL_ARM");
        String snapshot = System.getenv("EVAL_SNAPSHOT");
        boolean semantic = false;
        for (String cap : List.of("embedding", "intent", "eligibility")) {
            semantic |= Boolean.parseBoolean(env.getProperty("sellerops.knowledge." + cap + ".enabled", "false"));
        }
        boolean declaredOff = "true".equals(System.getenv("EVAL_KNOWLEDGE_MODELS_OFF"));
        if (declaredOff && semantic) {
            throw new IllegalStateException("EVAL_KNOWLEDGE_MODELS_OFF=true but a knowledge capability is enabled");
        }
        List<String> out = new ArrayList<>();
        for (String line : Files.readAllLines(Path.of(System.getenv("EVAL_QUESTIONS")))) {
            if (line.isBlank()) continue;
            JsonNode q = JSON.readTree(line);
            Inquiry inquiry = "R".equals(q.get("set").asText()) ? real(org, q.get("inquiry").asText()) : synthetic(org, q);
            InquiryKnowledgeAssessor.Assessment a = assessor.assess(org, inquiry, OrderFactLookup.STORED_ONLY);
            InquiryEvidenceRetriever.InquiryEvidence lanes = a.retrieved();
            ObjectNode row = JSON.createObjectNode();
            row.put("q", q.get("q").asText()).put("arm", arm).put("snapshot", snapshot).put("semantic", semantic);
            row.put("basis", a.basis().name());
            row.put("resolved_product", a.productId() == null ? null : a.productId().toString());
            ArrayNode current = row.putArray("current");
            ArrayNode memory = row.putArray("memory");
            for (InquiryEvidenceRetriever.ScopedPassage p : lanes.passages()) {
                if (p.scope() == KnowledgeScope.PAST_ANSWER) {
                    memory.add(p.sourceId().toString());
                } else if (p.scope().current()) {
                    current.addObject().put("scope", p.scope().name()).put("source", p.sourceId().toString());
                }
            }
            UUID precedent = a.gap() == null ? null : a.gap().precedentMemoryId();
            row.put("precedent", precedent == null ? null : precedent.toString());
            row.put("prefill_shown", precedent != null && CaseKnowledgeService.prefill(org, inquiry.getId(), a.productId(),
                    memories.findById(precedent).orElse(null)) != null);
            ObjectNode catalogue = row.putObject("catalogue");
            catalogue.put("grounds", a.catalogue() != null && a.catalogue().grounds());
            ArrayNode statements = catalogue.putArray("statements");
            if (a.catalogue() != null) {
                for (CatalogueInvestigator.Statement s : a.catalogue().matches()) {
                    statements.addObject().put("product", s.productId().toString()).put("field", s.field().name())
                            .put("fact_key", s.factKey()).put("text", s.text());
                }
            }
            ObjectNode variant = row.putObject("variant");
            variant.put("applicability", a.verdict() == null ? null : String.valueOf(a.verdict().applicability()));
            UUID v = a.verdict() == null ? null : a.verdict().variantId();
            variant.put("variant_id", v == null ? null : v.toString());
            variant.put("option_name", v == null ? null : variants.findById(v).map(x -> x.getOptionName()).orElse(null));
            row.put("order_state", lanes.order() == null ? null : String.valueOf(lanes.order().state()));
            out.add(JSON.writeValueAsString(row));
        }
        Files.write(Path.of(System.getenv("EVAL_OUT")), out);
        System.out.println("INQUIRY_NEED_EVAL arm=" + arm + " snapshot=" + snapshot + " semantic=" + semantic
                + " rows=" + out.size());
    }

    private Inquiry real(UUID org, String prefix) {
        UUID id = jdbc.queryForObject("select id from inquiries where org_id = ? and id::text like ?", UUID.class, org,
                prefix + "%");
        return inquiries.findById(id).orElseThrow();
    }

    /** A synthetic question, never saved: the same product and channel as the past answer it was written against. */
    private Inquiry synthetic(UUID org, JsonNode q) {
        String memoryPrefix = q.get("product_via_memory").asText();
        AnswerMemory source = memories.findAllByOrgId(org).stream()
                .filter(m -> m.getId().toString().startsWith(memoryPrefix)).findFirst().orElseThrow();
        Inquiry inquiry = new Inquiry();
        inquiry.setId(UUID.randomUUID());
        inquiry.setOrgId(org);
        inquiry.setProductId(source.getProductId());
        inquiry.setChannelId(jdbc.queryForObject("select channel_id from inquiries where id = ?", UUID.class,
                source.getOriginInquiryId()));
        inquiry.setTitle("");
        inquiry.setBody(q.get("text").asText());
        return inquiry;
    }
}
