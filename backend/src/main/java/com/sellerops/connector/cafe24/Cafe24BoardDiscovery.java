package com.sellerops.connector.cafe24;

import com.sellerops.connector.cafe24.Cafe24BoardClassifier.BoardKind;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * Board Discovery orchestrator: lists a mall's Cafe24 community boards
 * ({@link Cafe24BoardsClient}) and classifies each one ({@link Cafe24BoardClassifier})
 * into the {@code board_no → REVIEW / INQUIRY / OTHER} mapping that a later
 * review/inquiry collection slice will be keyed off.
 *
 * <p>Deliberately narrow scope: this reads <b>board metadata only</b> and does
 * <b>not</b> open the vault, refresh tokens, persist, or collect article content.
 * It is handed an already-minted access token — the existing connector
 * token-refresh chain ({@link Cafe24TokenClient} + {@link com.sellerops.credential.CredentialVault})
 * is wired in only at the gated live-verification step, never here. A
 * {@link Cafe24RateLimitedException} from the boards call propagates unchanged.
 *
 * <p>Board Discovery is <b>{@value #VERIFICATION_STATUS}</b>: the endpoint shape,
 * board-row field names, and the classifier's keyword rules are doc-asserted and
 * unverified until one gated {@code /boards} read against the real target mall
 * (see docs/sellerops_cafe24_community_board_discovery.md). The connector ships
 * flag-off by default, so nothing here runs until the flag is deliberately set.
 */
public class Cafe24BoardDiscovery {

    public static final String VERIFICATION_STATUS = "NEEDS_VERIFICATION";

    private final Cafe24BoardsClient boardsClient;
    private final Cafe24BoardClassifier classifier;

    public Cafe24BoardDiscovery(Cafe24BoardsClient boardsClient, Cafe24BoardClassifier classifier) {
        this.boardsClient = boardsClient;
        this.classifier = classifier;
    }

    /** List + classify the mall's boards into a sanitized discovery result. */
    public Result discover(String accessToken, String mallId) {
        List<ClassifiedBoard> classified = new ArrayList<>();
        Map<BoardKind, Integer> counts = new EnumMap<>(BoardKind.class);
        for (BoardKind kind : BoardKind.values()) {
            counts.put(kind, 0);
        }

        for (Cafe24BoardRow row : boardsClient.list(accessToken, mallId)) {
            BoardKind kind = classifier.classify(row);
            classified.add(new ClassifiedBoard(row.boardNo(), row.boardName(), kind));
            counts.merge(kind, 1, Integer::sum);
        }
        return new Result(List.copyOf(classified), Map.copyOf(counts));
    }

    /** One board placed in the discovery mapping (metadata only). */
    public record ClassifiedBoard(int boardNo, String boardName, BoardKind kind) {
    }

    /** Sanitized discovery output: the classified boards and a per-kind tally. */
    public record Result(List<ClassifiedBoard> boards, Map<BoardKind, Integer> countsByKind) {
    }
}
