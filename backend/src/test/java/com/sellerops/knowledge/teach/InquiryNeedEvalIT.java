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
    @Autowired com.sellerops.inquiry.decision.InquiryEvidenceCollector collector;
    @Autowired(required = false) com.sellerops.inquiry.authority.CapabilityRegistry registry;
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
        // Inquiry Decision v2 arms. `oracle`: the planner returns the gold needs and the judge says what the gold
        // evidence sets say about the candidates the PRODUCTION collector gathered — an upper bound of the structure
        // with a perfect semantic layer. `model`: whatever InquiryDecisionModel the context holds (the real door).
        String decisionMode = System.getenv().getOrDefault("EVAL_DECISION", "off");
        // Past-answer provenance (v2.1): the clones' rows predate the column and are all UNKNOWN, so the collector reads
        // the Eval v1 human annotations instead — evaluation only. A capture records every past answer the lanes found;
        // the calibration harness applies the same policy to it (CalibrationVariants).
        if ("capture".equals(decisionMode)) {
            collector.setScopeSource(m -> com.sellerops.knowledge.memory.AnswerMemoryReuseScope.REUSABLE);
        } else if (System.getenv("EVAL_PRECEDENTS") != null) {
            java.util.Map<String, com.sellerops.knowledge.memory.AnswerMemoryReuseScope> annotated =
                    new java.util.HashMap<>();
            for (String l : Files.readAllLines(Path.of(System.getenv("EVAL_PRECEDENTS")))) {
                if (!l.isBlank()) {
                    JsonNode p = JSON.readTree(l);
                    annotated.put(p.get("memory").asText(),
                            com.sellerops.knowledge.memory.AnswerMemoryReuseScope.valueOf(p.get("precedent_scope").asText()));
                }
            }
            collector.setScopeSource(m -> annotated.entrySet().stream()
                    .filter(e -> m.getId().toString().startsWith(e.getKey())).map(java.util.Map.Entry::getValue)
                    .findFirst().orElse(com.sellerops.knowledge.memory.AnswerMemoryReuseScope.UNKNOWN));
        }
        if ("oracle".equals(decisionMode) || "capture".equals(decisionMode)) {
            OracleDecision.capture = "capture".equals(decisionMode) ? new ArrayList<>() : null;
            assessor.setDecision(new OracleDecision(Path.of(System.getenv("EVAL_NEEDS")),
                    Path.of(System.getenv("EVAL_PRECEDENTS"))), collector);
        } else if ("off".equals(decisionMode)) {
            assessor.setDecision(null, null);
        }
        List<String> out = new ArrayList<>();
        List<String> plannerCapture = System.getenv("EVAL_PLANNER_CAPTURE") == null ? null : new ArrayList<>();
        for (String line : Files.readAllLines(Path.of(System.getenv("EVAL_QUESTIONS")))) {
            if (line.isBlank()) continue;
            JsonNode q = JSON.readTree(line);
            Inquiry inquiry = "R".equals(q.get("set").asText()) ? real(org, q.get("inquiry").asText()) : synthetic(org, q);
            OracleDecision.current = q.get("q").asText();
            InquiryKnowledgeAssessor.Assessment a = assessor.assess(org, inquiry, OrderFactLookup.STORED_ONLY);
            OracleDecision.products.put(OracleDecision.current, a.productId() == null ? null : a.productId().toString());
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
            if (plannerCapture != null) {
                // Inquiry v3 WP-2 planner capture (no model): the customer's message and the registry facts the planner
                // request is built from. The snapshot's own fingerprint travels with it, so a later run proves it asked
                // about the same situation.
                String subtype = inquiry.getSourceSubtype();
                com.sellerops.inquiry.authority.CapabilitySnapshot snap = registry.snapshot(org, inquiry, a.productId(),
                        collector.detail(org, a.productId()), OrderFactLookup.EXACT_ALLOWED);
                ObjectNode cap = JSON.createObjectNode();
                cap.put("q", q.get("q").asText()).put("question", plannerQuestion(inquiry));
                ObjectNode reg = cap.putObject("registry");
                reg.put("channel", snap.channelCode()).put("subtype", subtype)
                        .put("orderBound", snap.orderBound()).put("lookup", snap.lookup().name())
                        .put("product", a.productId() != null).put("detail", snap.detail().name())
                        .put("listingRow", snap.status(com.sellerops.inquiry.authority.EntityField.LISTING_SALE_STATUS)
                                == com.sellerops.inquiry.authority.CapabilityStatus.AVAILABLE)
                        .put("variantCount", snap.variantCount());
                cap.put("registry_fp", snap.fingerprint());
                plannerCapture.add(JSON.writeValueAsString(cap));
            }
            if (a.decision() != null) {
                observeDecision(row, a.decision());
            }
            out.add(JSON.writeValueAsString(row));
        }
        Files.write(Path.of(System.getenv("EVAL_OUT")), out);
        if (plannerCapture != null) {
            java.util.Set<String> canonicalQ = new java.util.HashSet<>();
            for (String line : Files.readAllLines(Path.of(System.getenv("EVAL_QUESTIONS")))) {
                if (!line.isBlank() && JSON.readTree(line).path("canonical").asBoolean(true)) {
                    canonicalQ.add(JSON.readTree(line).get("q").asText());
                }
            }
            List<String> rows = new ArrayList<>();
            for (String r : plannerCapture) {
                if (canonicalQ.contains(JSON.readTree(r).get("q").asText())) {
                    rows.add(r);
                }
            }
            Files.write(Path.of(System.getenv("EVAL_PLANNER_CAPTURE")), rows,
                    java.nio.file.StandardOpenOption.CREATE_NEW, java.nio.file.StandardOpenOption.WRITE);
            System.out.println("INQUIRY_NEED_EVAL planner_capture rows=" + rows.size());
        }
        if (OracleDecision.capture != null) {
            // The calibration set is the CANONICAL questions only — the headline weighting of Eval v1.
            java.util.Set<String> canonical = new java.util.HashSet<>();
            for (String line : Files.readAllLines(Path.of(System.getenv("EVAL_QUESTIONS")))) {
                if (!line.isBlank() && JSON.readTree(line).path("canonical").asBoolean(false)) {
                    canonical.add(JSON.readTree(line).get("q").asText());
                }
            }
            List<String> rows = new ArrayList<>();
            for (ObjectNode r : OracleDecision.capture) {
                if (canonical.contains(r.get("q").asText())) {
                    r.put("product", OracleDecision.products.get(r.get("q").asText()));
                    rows.add(JSON.writeValueAsString(r));
                }
            }
            Files.write(Path.of(System.getenv("EVAL_CAPTURE")), rows);
            System.out.println("INQUIRY_NEED_EVAL capture rows=" + rows.size());
        }
        System.out.println("INQUIRY_NEED_EVAL arm=" + arm + " snapshot=" + snapshot + " semantic=" + semantic
                + " rows=" + out.size());
    }

    /**
     * With a decision, what the product CITES is the evidence of the needs the decision covered or partly covered — so
     * that is what the observation reports as current passages, catalogue statements and the order fact.
     */
    private static void observeDecision(ObjectNode row, com.sellerops.inquiry.decision.NeedDecision d) {
        ArrayNode current = row.putArray("current");
        ArrayNode statements = ((ObjectNode) row.get("catalogue")).putArray("statements");
        ArrayNode memory = row.putArray("memory");
        boolean order = false;
        java.util.Set<com.sellerops.inquiry.decision.EvidenceCandidate> cited = new java.util.LinkedHashSet<>();
        for (com.sellerops.inquiry.decision.NeedResult n : d.needs()) {
            cited.addAll(n.evidence());
            n.precedents().forEach(p -> memory.add(p.memoryId().toString()));
        }
        for (com.sellerops.inquiry.decision.EvidenceCandidate e : cited) {
            switch (e.kind()) {
                case PRODUCT_KNOWLEDGE -> current.addObject().put("scope", "PRODUCT").put("source", String.valueOf(e.sourceId()));
                case ORG_KNOWLEDGE -> current.addObject().put("scope", "ORG_OPERATIONS").put("source", String.valueOf(e.sourceId()));
                case ORDER_FACT -> order = true;
                default -> {
                    String field = e.kind() == com.sellerops.inquiry.decision.EvidenceCandidate.Kind.OPTIONS ? "OPTION"
                            : e.kind() == com.sellerops.inquiry.decision.EvidenceCandidate.Kind.ADDONS ? "SUPPLEMENT" : "FACT";
                    for (String lineText : e.text().split("\n")) {
                        statements.addObject().put("product", String.valueOf(e.productId())).put("field", field)
                                .put("fact_key", e.factKey() != null ? e.factKey()
                                        : field.equals("FACT") && lineText.contains(":") ? lineText.substring(0, lineText.indexOf(':')) : null)
                                .put("text", lineText);
                    }
                }
            }
        }
        if (order) {
            row.put("order_state", "OBSERVED_STORED");
        }
        ObjectNode decision = row.putObject("decision");
        decision.put("outcome", d.outcome().name()).put("calls", d.cost().calls())
                .put("prompt_tokens", d.cost().promptTokens()).put("completion_tokens", d.cost().completionTokens())
                .put("evidence_candidates", d.evidenceCandidates()).put("precedent_candidates", d.precedentCandidates())
                .put("detail", String.valueOf(d.detail()));
        ArrayNode needs = decision.putArray("needs");
        d.needs().forEach(n -> {
            ObjectNode o = needs.addObject().put("id", n.need().id()).put("status", n.status().name())
                    .put("evidence", n.evidence().size()).put("acquirable", n.acquirable());
            // Inquiry v3 WP-1: present only when the authority fence ran, so a fence-OFF observation is byte-identical.
            if (n.resolution() != null) {
                o.put("authority", n.resolution().authority().name())
                        .put("capability", n.resolution().capability().wire())
                        .put("resolution", n.resolution().state().name())
                        .put("gap", n.resolution().gap() == null ? null : n.resolution().gap().name())
                        .put("enforcement", n.enforcement() == null ? null : n.enforcement().name());
            }
        });
    }

    /**
     * The oracle decision model: the gold needs as the plan, and the gold evidence sets as the judge — applied to the
     * candidates the production collector actually gathered. Nothing here reads a sentence.
     */
    static final class OracleDecision implements com.sellerops.inquiry.decision.InquiryDecisionModel {
        static String current;
        static final java.util.Map<String, String> products = new java.util.HashMap<>();
        private final java.util.Map<String, List<JsonNode>> needsByQ = new java.util.LinkedHashMap<>();
        private final java.util.Set<String> reusable = new java.util.HashSet<>();

        OracleDecision(Path needs, Path precedents) throws java.io.IOException {
            for (String l : Files.readAllLines(needs)) {
                if (!l.isBlank()) {
                    JsonNode n = JSON.readTree(l);
                    needsByQ.computeIfAbsent(n.get("q").asText(), k -> new ArrayList<>()).add(n);
                }
            }
            for (String l : Files.readAllLines(precedents)) {
                if (!l.isBlank()) {
                    JsonNode p = JSON.readTree(l);
                    if ("REUSABLE".equals(p.get("precedent_scope").asText())) {
                        reusable.add(p.get("memory").asText());
                    }
                }
            }
        }

        @Override
        public boolean enabledFor(UUID orgId) {
            return true;
        }

        @Override
        public Answer<List<com.sellerops.inquiry.decision.InquiryNeed>> plan(UUID orgId, String question) {
            List<com.sellerops.inquiry.decision.InquiryNeed> out = new ArrayList<>();
            for (JsonNode n : needsByQ.getOrDefault(current, List.of())) {
                out.add(new com.sellerops.inquiry.decision.InquiryNeed(n.get("need").asText(), n.get("ask").asText(),
                        com.sellerops.inquiry.decision.NeedType.valueOf(n.get("type").asText()), n.get("ask").asText()));
            }
            return new Answer<>(out, CallCost.NONE);
        }

        @Override
        public Answer<java.util.Map<String, com.sellerops.inquiry.decision.NeedVerdict>> judge(UUID orgId,
                String question, List<com.sellerops.inquiry.decision.InquiryNeed> needs,
                List<com.sellerops.inquiry.decision.EvidenceCandidate> evidence,
                List<com.sellerops.inquiry.decision.PrecedentCandidate> precedents) {
            java.util.Map<String, com.sellerops.inquiry.decision.NeedVerdict> out = new java.util.LinkedHashMap<>();
            java.util.Map<String, JsonNode> gold = new java.util.HashMap<>();
            needsByQ.getOrDefault(current, List.of()).forEach(n -> gold.put(n.get("need").asText(), n));
            for (com.sellerops.inquiry.decision.InquiryNeed need : needs) {
                JsonNode g = gold.get(need.id());
                com.sellerops.inquiry.decision.GoldEvidence.Verdict v =
                        com.sellerops.inquiry.decision.GoldEvidence.judge(g, evidence);
                List<String> prec = new ArrayList<>();
                for (JsonNode m : g.get("precedents")) {
                    if (reusable.contains(m.asText())) {
                        precedents.stream().filter(p -> p.memoryId().toString().startsWith(m.asText()))
                                .forEach(p -> prec.add(p.id()));
                    }
                }
                com.sellerops.inquiry.decision.NeedStatus status = v.status();
                out.put(need.id(), com.sellerops.inquiry.decision.NeedVerdict.of(need.id(), status, v.ids(), null,
                        status == com.sellerops.inquiry.decision.NeedStatus.CONDITIONAL_ON_CUSTOMER ? "고객 정보 확인" : null,
                        prec));
            }
            if (capture != null) {
                capture.add(captured(question, needs, evidence, precedents));
            }
            return new Answer<>(out, CallCost.NONE);
        }

        /**
         * One judge input exactly as the production engine would send it — numbered candidates, gold needs — plus the
         * never-sent keys the calibration harness needs to apply gold refs and provenance. Written to the scratch
         * directory only: it holds the customer's message and the seller's texts, so it never enters the repository.
         */
        static ObjectNode captured(String question, List<com.sellerops.inquiry.decision.InquiryNeed> needs,
                                   List<com.sellerops.inquiry.decision.EvidenceCandidate> evidence,
                                   List<com.sellerops.inquiry.decision.PrecedentCandidate> precedents) {
            ObjectNode row = JSON.createObjectNode();
            row.put("q", current).put("question", question);
            ArrayNode n = row.putArray("needs");
            needs.forEach(x -> n.addObject().put("id", x.id()).put("ask", x.ask()).put("type", x.type().name()));
            ArrayNode e = row.putArray("evidence");
            evidence.forEach(x -> e.addObject().put("id", x.id()).put("kind", x.kind().name()).put("label", x.label())
                    .put("text", x.text()).put("source", x.sourceId() == null ? null : x.sourceId().toString())
                    .put("product", x.productId() == null ? null : x.productId().toString()).put("fact_key", x.factKey()));
            ArrayNode p = row.putArray("precedents");
            precedents.forEach(x -> p.addObject().put("id", x.id()).put("memory", x.memoryId().toString())
                    .put("text", x.text()));
            return row;
        }

        static List<ObjectNode> capture;
    }

    /** The customer's message as the planner receives it — the same plain text the assessor reads. */
    private static String plannerQuestion(Inquiry inquiry) {
        String title = com.sellerops.common.MarkupText.toPlainText(inquiry.getTitle());
        String body = com.sellerops.common.MarkupText.toPlainText(inquiry.getBody());
        return ((title == null ? "" : title) + "\n" + (body == null ? "" : body)).strip();
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
