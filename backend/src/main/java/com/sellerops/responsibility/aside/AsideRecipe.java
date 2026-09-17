package com.sellerops.responsibility.aside;

import com.sellerops.connector.DataType;
import java.util.Optional;

/**
 * <b>The published recipes an unattended helper may be asked to run.</b>
 *
 * <p>This enum is the allowlist. A job row's {@code recipe} column is checked against these names in the
 * schema as well, so a recipe this type does not publish cannot be stored even by code that forgot to ask.
 *
 * <p>Adding a value here is not a refactor. It is a decision that a new thing may happen on a seller's computer
 * while nobody is looking, and it belongs with the person who owns that decision — which is why there is no
 * registry, no configuration key and no string pass-through anywhere in this package.
 *
 * <p><b>Two kinds of recipe, and the difference is the whole of the risk.</b> A recipe with no
 * {@link #channelCode()} reads a surface this repository serves itself; one that names a channel points the
 * seller's own authenticated browser at a real marketplace. The second kind is gated separately
 * ({@link AsideMarketplaceAccess}) — off unless a deployment names the organisation AND the seller account —
 * and can still only do what its bound workflow does: one published route, one page, no click.
 */
public enum AsideRecipe {

    /**
     * Open the observation surface this repository serves on loopback, read the items it prints, report how
     * many. Touches no marketplace, no seller data and no credential: the helper resolves this name to its own
     * fixture route and refuses any other target locally ({@code fixture-observe-workflow.ts}).
     */
    CUSTOMER_OPERATIONS_FIXTURE_OBSERVE_V1(null, null),

    /**
     * <b>Read one page of the seller's own Coupang WING 리뷰 목록, with nobody watching.</b>
     *
     * <p>Every part of the read itself was live-proven before this name existed (Coupang ASIDE operator-run
     * lane, 2026-09-12/14). The helper resolves this name to {@code COUPANG_REVIEW_READ_WORKFLOW} — one route
     * WING's own menu published, screened by the product's WING classifier exactly as the loopback recipe is
     * screened for loopback — and runs the frozen deterministic runtime, which performs <b>zero clicks, zero
     * keystrokes, zero downloads, zero writes</b> and calls no model. The store-identity fence is unchanged: a
     * page whose store does not match the digest of this account's own vendor code drops its rows unread.
     *
     * <p><b>What this name changes is exactly one thing: who authorises the run.</b> On the operator-run lane it
     * was a seller pressing 지금 동기화, once per read. Here it is the seller activating the responsibility, plus
     * a deployment naming this organisation and this seller account. Every other bound the pressed run had is
     * still a bound: the job row is single-use, leased, one-per-device and TTL-bounded, and pagination remains
     * unimplemented — one window asks for one page.
     */
    COUPANG_REVIEW_OBSERVE_V1("COUPANG", DataType.REVIEW),

    /**
     * <b>Read the seller's own NAVER Seller Center 리뷰 목록 for its default period, with nobody watching.</b>
     *
     * <p>Unlike the Coupang recipe this one carries rows to canonical ingest, so it was not written until a
     * READ-ONLY discovery on the real logged-in surface (2026-09-17) established the three facts a scheduled
     * read cannot do without — measured, not assumed:
     *
     * <ul>
     *   <li><b>a stable source id with no click.</b> The list is an ag-Grid whose own row model holds every row
     *   of the default period (52 of 52 loaded, one page). Each row's {@code id} equals the review id the
     *   row's detail link opens ({@code openReviewDetailModal(id)}, 15/15 rendered rows) — the same id the
     *   guided reply lane matched against the exported 리뷰글번호 live on 2026-09-03 and 09-05. The DOM
     *   {@code row-id} is the grid's index and is NOT used.</li>
     *   <li><b>a store fence the backend can judge.</b> Every product number on the page (11/11) is in this
     *   organisation's NAVER catalogue, collected by the official API with this account's own credential, and
     *   in no other organisation's. 채널상품번호 is NAVER-global, so a page of another store's reviews cannot pass.
     *   The comparison runs on the backend; the helper is never handed the catalogue.</li>
     *   <li><b>truthful coverage.</b> The screen's default period (7 days) is the bound. A run never claims the
     *   store's whole review history — its source row is {@code BOUNDED}, never {@code COMPLETE}.</li>
     * </ul>
     *
     * <p>No click, no keystroke, no scroll, no download, no export, no reply and no model call. The buyer's id,
     * masked id and order number are in the same row model and are never read out of the page.
     */
    NAVER_REVIEW_OBSERVE_V1("NAVER", DataType.REVIEW),

    /**
     * <b>Read the newest page of the seller's own NAVER Seller Center 문의 관리 (상품 문의), with nobody watching.</b>
     *
     * <p>Written only after a READ-ONLY discovery on the real logged-in surface (2026-09-17) measured what a
     * scheduled inquiry read cannot do without:
     *
     * <ul>
     *   <li><b>the same source id the official API uses.</b> The screen (AngularJS, {@code #/comment/}) keeps its rows
     *   on the view controller, and each row's {@code id} is the Commerce API's {@code questionId}: on 7/7 inquiries
     *   the official API had already stored, the id, the creation instant to the millisecond and a SHA-256 of the
     *   question text were identical. So a browser read and an API read of one inquiry are one canonical row
     *   ({@code naver-qna:<id>}), and neither overwrites the other.</li>
     *   <li><b>a store fence the backend can judge.</b> Every row's product link opens its 채널상품번호 (8/8 rendered
     *   rows) — the same identifier the NAVER review recipe is fenced on.</li>
     *   <li><b>truthful coverage.</b> The screen pages at 8 rows over a default 3-month period and pagination is a
     *   click, which this recipe does not make. A read is therefore the NEWEST page, and it is {@code BOUNDED} only
     *   when that page provably reaches everything newer than what was already stored (the page's oldest row was
     *   stored before, or the page holds the whole period); otherwise it is {@code PARTIAL}.</li>
     * </ul>
     *
     * <p>No click, no keystroke, no scroll, no download, no reply and no model call. The buyer's masked id, member
     * number, and the audit block with the writer's IP are on the same row object and are never read out.
     */
    NAVER_PRODUCT_INQUIRY_OBSERVE_V1("NAVER", DataType.INQUIRY);

    private final String channelCode;
    private final DataType dataType;

    AsideRecipe(String channelCode, DataType dataType) {
        this.channelCode = channelCode;
        this.dataType = dataType;
    }

    /**
     * The marketplace this recipe reads, when it reads one at all.
     *
     * <p>Empty is not «unknown»: it is the statement that this recipe touches no channel, which is what makes
     * {@link AsideSourceObserver#DATA_TYPE} the right label for its row. A present value is what makes the run
     * source row say COUPANG · REVIEW, so a surface reading those rows sees a channel read for what it is
     * rather than as an internal fixture.
     */
    public Optional<String> channelCode() {
        return Optional.ofNullable(channelCode);
    }

    /** What this recipe's reading is about, for a marketplace recipe. Empty for an owned surface. */
    public Optional<DataType> dataType() {
        return Optional.ofNullable(dataType);
    }

    /** Whether running this recipe points a browser at a marketplace. The gate and the row label both ask. */
    public boolean readsMarketplace() {
        return channelCode != null;
    }

    /**
     * A short, stable tag for this recipe inside a job's {@code clientJobId}.
     *
     * <p>Exists because {@code enqueue} is idempotent on {@code (device, clientJobId)}: a run that hands out two
     * recipes must give them two ids, or the second would silently re-find the first's job and one of the two
     * reads would never be asked for. The id is bounded at 64 characters and a run id already spends 43, so the
     * name itself does not fit — hence a tag rather than the name.
     *
     * <p>Written out rather than derived from {@link #ordinal()}: an ordinal is a fact about declaration order,
     * and reordering this enum would silently re-point ids that are already stored.
     */
    public String jobTag() {
        return switch (this) {
            case CUSTOMER_OPERATIONS_FIXTURE_OBSERVE_V1 -> "fx";
            case COUPANG_REVIEW_OBSERVE_V1 -> "cp";
            case NAVER_REVIEW_OBSERVE_V1 -> "nr";
            case NAVER_PRODUCT_INQUIRY_OBSERVE_V1 -> "ni";
        };
    }
}
