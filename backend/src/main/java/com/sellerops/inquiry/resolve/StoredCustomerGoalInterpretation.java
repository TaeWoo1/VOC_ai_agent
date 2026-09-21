package com.sellerops.inquiry.resolve;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sellerops.agent.llm.goal.InquiryGoalGenerator;
import com.sellerops.agent.llm.goal.InquiryGoalService;
import com.sellerops.agent.quota.AgentQuotaService;
import com.sellerops.agent.quota.AgentUsageKind;
import com.sellerops.agent.quota.QuotaDecision;
import com.sellerops.common.MarkupText;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.goal.CustomerGoalResponseParser;
import com.sellerops.inquiry.goal.CustomerGoalSet;
import com.sellerops.inquiry.goal.InquiryGoalInterpretation;
import com.sellerops.inquiry.goal.InquiryGoalInterpretationRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

/**
 * <b>The one production reader of a customer's sentence into goals</b> — stored once, reused everywhere.
 *
 * <h2>Ask once</h2>
 *
 * <p>A reading is keyed by {@code (org, inquiry, exact message, contract)}. The first path to need it pays for it;
 * every later path reads the row. That is not only a cost decision: the interpreter is a model, so two calls on the
 * same sentence can disagree, and a case whose conclusion changed because somebody opened a screen is a case
 * nobody can explain. The stored reading is what makes the resolution downstream reproducible.
 *
 * <p>An edited message has a different fingerprint and is therefore a different question, not a stale answer. A new
 * prompt version is a different contract and gets its own row rather than overwriting what an earlier one
 * concluded.
 *
 * <h2>Fail closed, and distinguish the failures</h2>
 *
 * <p>Everything that is not a complete, contract-satisfying reading returns {@link Optional#empty()}, which the
 * case runtime treats as «nobody read this message» — the rules decide, exactly as before. What differs is what is
 * <b>written</b>:
 *
 * <ul>
 *   <li><b>The model answered and the contract refused it</b> — recorded. The same bytes will refuse again, and
 *       paying a vendor twice to learn that is waste.</li>
 *   <li><b>Capability off, budget exhausted, transport failed, no message text</b> — nothing written. Nothing was
 *       established, and a row saying otherwise would turn «we did not ask» into «there is no answer».</li>
 * </ul>
 *
 * <h2>An ACTION goal is still not authority</h2>
 *
 * <p>This class produces goals; it executes nothing and approves nothing. The effectful capability remains
 * {@code DECLARED_NO_EXECUTOR} and {@link InquiryGoalResolvers} answers it with one constant, which
 * {@code InquiryResolutionSafetyTest} sweeps. Turning this capability on cannot make an {@code ACTION} verdict
 * reach a marketplace, because nothing downstream of it can act.
 */
@Service
public class StoredCustomerGoalInterpretation implements CustomerGoalInterpretation {

    private static final Logger log = LoggerFactory.getLogger(StoredCustomerGoalInterpretation.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final InquiryGoalInterpretationRepository stored;
    private final InquiryGoalService goals;
    private final AgentQuotaService quota;

    public StoredCustomerGoalInterpretation(InquiryGoalInterpretationRepository stored, InquiryGoalService goals,
                                            AgentQuotaService quota) {
        this.stored = stored;
        this.goals = goals;
        this.quota = quota;
    }

    @Override
    public Optional<CustomerGoalSet> interpret(UUID orgId, Inquiry inquiry) {
        if (orgId == null || inquiry == null || inquiry.getId() == null) {
            return Optional.empty();
        }
        String message = messageOf(inquiry);
        if (message.isBlank()) {
            return Optional.empty();
        }
        String fingerprint = sha256(message);
        String contract = goals.promptVersion();

        Optional<InquiryGoalInterpretation> reused = read(orgId, inquiry.getId(), fingerprint, contract);
        if (reused.isPresent()) {
            return setOf(reused.get(), message);
        }
        // Everything below this line can reach a vendor, and nothing above it does.
        if (!goals.isEnabledFor(orgId)) {
            return Optional.empty();
        }
        QuotaDecision charged = quota.consume(orgId, AgentUsageKind.INTERPRET, "inquiry-goal:" + inquiry.getId());
        if (!charged.allowed()) {
            return Optional.empty();
        }
        InquiryGoalGenerator.Result result = goals.interpret(orgId, message);
        if (result.parsed().isEmpty()) {
            return Optional.empty();   // transport, http, no text — nothing was established
        }
        CustomerGoalResponseParser.Parsed parsed = result.parsed().get();
        save(orgId, inquiry.getId(), fingerprint, contract, result.model(), parsed);
        return parsed.refused() ? Optional.empty() : Optional.of(parsed.set());
    }

    /** The sentence the interpreter reads, and the sentence its quotes are checked against. One definition. */
    public static String messageOf(Inquiry inquiry) {
        String title = MarkupText.toPlainText(inquiry.getTitle());
        String body = MarkupText.toPlainText(inquiry.getBody());
        return ((title == null ? "" : title) + "\n" + (body == null ? "" : body)).strip();
    }

    private Optional<InquiryGoalInterpretation> read(UUID orgId, UUID inquiryId, String fingerprint,
                                                     String contract) {
        return stored.findByOrgIdAndInquiryIdAndSourceFingerprintAndPromptVersion(orgId, inquiryId, fingerprint,
                contract);
    }

    /**
     * A stored reading, re-read under the contract it was stored against.
     *
     * <p>It goes back through the parser rather than being trusted: the row is a record of what a model said, and
     * the rules that admitted it are the rules that should admit it again. A row that no longer parses is a
     * refusal, not a silent half-answer.
     */
    private Optional<CustomerGoalSet> setOf(InquiryGoalInterpretation row, String message) {
        if (row.getOutcome() != InquiryGoalInterpretation.Outcome.INTERPRETED || row.getGoalSet() == null) {
            return Optional.empty();
        }
        CustomerGoalResponseParser.Parsed parsed = CustomerGoalResponseParser.parse(row.getGoalSet(), message);
        if (parsed.refused()) {
            log.info("inquiry_goal stored reading no longer satisfies its contract org={} reason={}",
                    row.getOrgId(), parsed.failure());
            return Optional.empty();
        }
        return Optional.of(parsed.set());
    }

    private void save(UUID orgId, UUID inquiryId, String fingerprint, String contract, String model,
                      CustomerGoalResponseParser.Parsed parsed) {
        InquiryGoalInterpretation row = new InquiryGoalInterpretation();
        row.setOrgId(orgId);
        row.setInquiryId(inquiryId);
        row.setSourceFingerprint(fingerprint);
        row.setPromptVersion(contract);
        row.setModelVersion(model);
        if (parsed.refused()) {
            row.setOutcome(InquiryGoalInterpretation.Outcome.REFUSED);
            row.setFailure(parsed.failure());
        } else {
            ObjectNode set = MAPPER.createObjectNode();
            set.set("goals", parsed.goals());
            set.set("relations", parsed.relations());
            row.setOutcome(InquiryGoalInterpretation.Outcome.INTERPRETED);
            row.setGoalSet(set.toString());
        }
        try {
            stored.save(row);
        } catch (DataIntegrityViolationException raced) {
            // Another path read the same sentence first. Its row is the reading; ours was the same call.
            log.info("inquiry_goal reading already recorded by a concurrent path org={}", orgId);
        }
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}
