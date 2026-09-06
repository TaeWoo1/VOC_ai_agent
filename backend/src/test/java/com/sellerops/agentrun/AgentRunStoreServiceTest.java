package com.sellerops.agentrun;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.agentrun.dto.AgentRunClaimResponse;
import com.sellerops.agentrun.dto.AgentRunStateRequest;
import com.sellerops.agentrun.dto.AgentRunStateResponse;
import com.sellerops.common.ApiException;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.ActiveProfiles;

/**
 * The durable run store's concurrency + isolation + sanitization contract, against a real (H2) DB.
 *
 * <p>The optimistic-lock CAS is proven deterministically here (a stale expected version changes 0
 * rows → conflict; a claim of a run someone else advanced changes 0 rows → CONFLICT/ALREADY_DONE);
 * true simultaneous resume is proven end-to-end in the live proof and against the fake backend in the
 * agent-runtime suite. Org isolation and the raw-content key rejection are also owned here.
 */
@DataJpaTest
@ActiveProfiles("test")
class AgentRunStoreServiceTest {

    @Autowired AgentRunRepository repository;

    private final ObjectMapper mapper = new ObjectMapper();
    private AgentRunStoreService service;
    private final UUID orgA = UUID.randomUUID();
    private final UUID orgB = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new AgentRunStoreService(repository, mapper);
    }

    private JsonNode snap(String json) {
        try {
            return mapper.readTree(json);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private AgentRunStateRequest insert(String domain, String status, String snapshotJson) {
        return new AgentRunStateRequest(domain, status, null, snap(snapshotJson));
    }

    // ---------------------------------------------------------------- insert / update / version

    @Test
    void insertThenGetReturnsVersionOneAndSnapshot() {
        service.upsert(orgA, "t1", insert("INQUIRY", "AWAITING_APPROVAL", "{\"phase\":\"await\"}"));
        AgentRunStateResponse got = service.get(orgA, "t1");
        assertThat(got.version()).isEqualTo(1L);
        assertThat(got.domain()).isEqualTo("INQUIRY");
        assertThat(got.status()).isEqualTo("AWAITING_APPROVAL");
        assertThat(got.snapshot().get("phase").asText()).isEqualTo("await");
    }

    @Test
    void insertingAnExistingThreadIsAConflict() {
        service.upsert(orgA, "t1", insert("INQUIRY", "AWAITING_APPROVAL", "{}"));
        assertThatThrownBy(() -> service.upsert(orgA, "t1", insert("INQUIRY", "AWAITING_APPROVAL", "{}")))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(HttpStatus.CONFLICT));
    }

    @Test
    void updateWithCorrectVersionBumpsAndUpdateWithStaleVersionFailsClosed() {
        service.upsert(orgA, "t1", insert("INQUIRY", "AWAITING_APPROVAL", "{}"));
        AgentRunStateResponse updated = service.upsert(
                orgA, "t1", new AgentRunStateRequest("INQUIRY", "DONE", 1L, snap("{\"decision\":\"APPROVED\"}")));
        assertThat(updated.version()).isEqualTo(2L);
        assertThat(updated.status()).isEqualTo("DONE");

        // A second write still expecting version 1 is stale → conflict, no overwrite.
        assertThatThrownBy(() -> service.upsert(
                        orgA, "t1", new AgentRunStateRequest("INQUIRY", "DONE", 1L, snap("{}"))))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(HttpStatus.CONFLICT));
        assertThat(service.get(orgA, "t1").snapshot().get("decision").asText()).isEqualTo("APPROVED");
    }

    @Test
    void updateOfUnknownThreadFailsClosed() {
        assertThatThrownBy(() -> service.upsert(
                        orgA, "ghost", new AgentRunStateRequest("INQUIRY", "DONE", 1L, snap("{}"))))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(HttpStatus.CONFLICT));
    }

    @Test
    void getUnknownThreadIsNotFound() {
        assertThatThrownBy(() -> service.get(orgA, "ghost"))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(HttpStatus.NOT_FOUND));
    }

    // ---------------------------------------------------------------- claim (exactly-once gate)

    @Test
    void claimOnAwaitingTransitionsToResumingAndBumpsVersion() {
        service.upsert(orgA, "t1", insert("REVIEW", "AWAITING_APPROVAL", "{}"));
        AgentRunClaimResponse claim = service.claim(orgA, "t1");
        assertThat(claim.outcome()).isEqualTo("CLAIMED");
        assertThat(claim.version()).isEqualTo(2L);
        assertThat(repository.findByOrgIdAndThreadId(orgA, "t1").orElseThrow().getStatus()).isEqualTo("RESUMING");
    }

    @Test
    void aStaggeredSecondClaimIsRefusedBecauseTheRowLeftTheClaimableState() {
        // H1 regression: the winner's claim moves the row to RESUMING, so a second claimer that reads
        // AFTER the winner's commit still cannot re-claim (the exactly-once gate the review mint needs).
        service.upsert(orgA, "t1", insert("REVIEW", "AWAITING_APPROVAL", "{}"));
        assertThat(service.claim(orgA, "t1").outcome()).isEqualTo("CLAIMED"); // winner → RESUMING
        assertThat(service.claim(orgA, "t1").outcome()).isEqualTo("CONFLICT"); // staggered loser
    }

    @Test
    void claimOfAFinishedRunReplaysAlreadyDone() {
        service.upsert(orgA, "t1", insert("REVIEW", "AWAITING_APPROVAL", "{}"));
        service.upsert(orgA, "t1", new AgentRunStateRequest("REVIEW", "DONE", 1L, snap("{\"decision\":\"APPROVED\"}")));
        AgentRunClaimResponse claim = service.claim(orgA, "t1");
        assertThat(claim.outcome()).isEqualTo("ALREADY_DONE");
        assertThat(claim.snapshot().get("decision").asText()).isEqualTo("APPROVED");
    }

    @Test
    void anAbandonedResumingClaimIsReclaimableOnceItsLeaseElapses() {
        service.upsert(orgA, "t1", insert("REVIEW", "AWAITING_APPROVAL", "{}"));
        assertThat(service.claim(orgA, "t1").outcome()).isEqualTo("CLAIMED"); // → RESUMING, claimed now
        // Simulate the claimer dying and the lease elapsing (age claimed_at well past the 2-min lease).
        AgentRun run = repository.findByOrgIdAndThreadId(orgA, "t1").orElseThrow();
        run.setClaimedAt(java.time.Instant.now().minusSeconds(3600));
        repository.saveAndFlush(run);
        assertThat(service.claim(orgA, "t1").outcome()).isEqualTo("CLAIMED"); // recovered, not wedged
    }

    // -------------------------------------------- PROCEDURE cursor (Production Closure v1 §1/§2)

    @Test
    void aStoppedProcedureCursorIsClaimableAndOnlyOnce() {
        // A procedure that stopped for a person rests in WAITING_HUMAN. It has to be continuable by a
        // process that did not start it (a container replacement) and by exactly one of them (two
        // replicas), which is the same lock a run waiting on an approval already uses.
        service.upsert(orgA, "c-1:ANSWER_INQUIRY", insert("PROCEDURE", "WAITING_HUMAN", "{\"step\":\"prepare\"}"));
        assertThat(service.claim(orgA, "c-1:ANSWER_INQUIRY").outcome()).isEqualTo("CLAIMED");
        assertThat(service.claim(orgA, "c-1:ANSWER_INQUIRY").outcome()).isEqualTo("CONFLICT");
    }

    @Test
    void aProcedureCursorMayNotCarryTheSellersOrACustomersWords() {
        // Unlike a transcript, a cursor has nothing of its own to keep: it is ids, closed tokens and a
        // step name, so the STRICT forbidden set applies even to the keys CONVERSATION owns.
        assertThatThrownBy(() -> service.upsert(orgA, "c-2:ANSWER_INQUIRY",
                        insert("PROCEDURE", "WAITING_HUMAN", "{\"turns\":[{\"text\":\"안녕하세요\"}]}")))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(HttpStatus.BAD_REQUEST));
    }

    @Test
    void claimOfUnknownThreadIsNotFound() {
        assertThatThrownBy(() -> service.claim(orgA, "ghost"))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(HttpStatus.NOT_FOUND));
    }

    // ---------------------------------------------------------------- tenant isolation

    @Test
    void oneOrgCannotSeeResumeOrCollideWithAnotherOrgsRun() {
        service.upsert(orgA, "shared", insert("INQUIRY", "AWAITING_APPROVAL", "{\"phase\":\"a\"}"));

        assertThatThrownBy(() -> service.get(orgB, "shared"))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(HttpStatus.NOT_FOUND));
        assertThatThrownBy(() -> service.claim(orgB, "shared"))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(HttpStatus.NOT_FOUND));

        // Org B may use the SAME thread id for its own independent run without touching org A's.
        service.upsert(orgB, "shared", insert("INQUIRY", "AWAITING_APPROVAL", "{\"phase\":\"b\"}"));
        assertThat(service.get(orgA, "shared").snapshot().get("phase").asText()).isEqualTo("a");
        assertThat(service.get(orgB, "shared").snapshot().get("phase").asText()).isEqualTo("b");
    }

    // ---------------------------------------------------------------- sanitization + validation

    @Test
    void rejectsSnapshotCarryingARawContentKeyTopLevelOrNested() {
        assertThatThrownBy(() -> service.upsert(orgA, "t1", insert("INQUIRY", "AWAITING_APPROVAL", "{\"body\":\"hi\"}")))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(HttpStatus.BAD_REQUEST));
        assertThatThrownBy(() -> service.upsert(
                        orgA, "t2", insert("INQUIRY", "AWAITING_APPROVAL", "{\"outcome\":{\"comments\":\"x\"}}")))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(HttpStatus.BAD_REQUEST));
    }

    @Test
    void allowsSanitizedLookalikeKeysThatAreNotRawContent() {
        // draftVersion / bodyFingerprint / note / title are sanitized fields, NOT raw content.
        AgentRunStateResponse ok = service.upsert(
                orgA,
                "t1",
                insert(
                        "REVIEW",
                        "AWAITING_APPROVAL",
                        "{\"draftVersion\":3,\"note\":\"declined\",\"targetHint\":{\"bodyFingerprint\":\"abc\"}}"));
        assertThat(ok.version()).isEqualTo(1L);
    }

    @Test
    void acceptsNestedNullValuesInTheSnapshot() {
        // A rejected run's outcome carries null executionStatus/category/approvedFingerprint — nested
        // null VALUES are legitimate and must not be mistaken for a missing snapshot.
        AgentRunStateResponse ok = service.upsert(
                orgA,
                "t1",
                insert(
                        "INQUIRY",
                        "DONE",
                        "{\"outcome\":{\"decision\":\"REJECTED\",\"executionStatus\":null,\"category\":null,"
                                + "\"approvedFingerprint\":null,\"note\":\"operator declined\"}}"));
        assertThat(ok.version()).isEqualTo(1L);
    }

    @Test
    void rejectsUnknownDomainOrStatus() {
        assertThatThrownBy(() -> service.upsert(orgA, "t1", insert("NOPE", "AWAITING_APPROVAL", "{}")))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.upsert(orgA, "t2", insert("INQUIRY", "WEIRD", "{}")))
                .isInstanceOf(ApiException.class);
    }

    // ── Pilot Readiness Closure v1 §7 — conversations are what a deployed host actually stores ──

    @Test
    void aConversationTurnCanBeStored_becauseProductionHasNoOtherStore() {
        AgentRunStateResponse got = service.upsert(orgA, "c1",
                insert("CONVERSATION", "OPEN",
                        "{\"turns\":[{\"role\":\"USER\",\"text\":\"미답변 문의 보여줘\"},"
                                + "{\"role\":\"ASSISTANT\",\"message\":\"답변 안 한 문의는 3건입니다.\"}]}"));

        assertThat(got.domain()).isEqualTo("CONVERSATION");
        assertThat(got.status()).isEqualTo("OPEN");
    }

    @Test
    void aConversationWaitingOnTheSellerIsAValidStatus() {
        assertThat(service.upsert(orgA, "c2", insert("CONVERSATION", "WAITING_HUMAN", "{\"turns\":[]}")).status())
                .isEqualTo("WAITING_HUMAN");
    }

    @Test
    void aConversationStillMayNotCarryTheCustomersWords() {
        assertThatThrownBy(() -> service.upsert(orgA, "c3",
                insert("CONVERSATION", "OPEN", "{\"turns\":[{\"artifacts\":[{\"body\":\"고객이 쓴 문장\"}]}]}")))
                .as("the narrowing is three keys the conversation contract owns — not the fence")
                .isInstanceOf(ApiException.class);

        assertThatThrownBy(() -> service.upsert(orgA, "c4",
                insert("CONVERSATION", "OPEN", "{\"turns\":[{\"artifacts\":[{\"draft\":\"초안\"}]}]}")))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void theNarrowingIsScopedToConversations_aRunSnapshotStillMayNotCarryText() {
        assertThatThrownBy(() -> service.upsert(orgA, "t9",
                insert("INQUIRY", "DONE", "{\"text\":\"무언가\"}")))
                .as("a run snapshot has no transcript, so nothing there owns these keys")
                .isInstanceOf(ApiException.class);
    }
}
