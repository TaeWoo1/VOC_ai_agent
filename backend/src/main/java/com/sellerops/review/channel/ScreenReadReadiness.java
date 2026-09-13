package com.sellerops.review.channel;

/**
 * Whether this seller account can start a screen read of its marketplace review list at all — the
 * question 「지금 동기화」 used to answer only by being pressed.
 *
 * <p><b>Every value is a fact this backend already holds.</b> None of them touches a marketplace, a
 * browser, or the seller's login: the three that are not {@code READY} are the three refusals
 * {@link ChannelReviewAcquisitionService#mint} has always made, named instead of thrown, so a screen
 * can say what is wrong before a seller presses a button that cannot work.
 *
 * <p><b>What is deliberately NOT here: whether the marketplace is logged in.</b> Finding that out
 * means reading the marketplace, and a readiness panel that made a marketplace request every time a
 * page rendered would spend the seller's session to decorate a screen. Login is discovered by the run
 * and reported as a closed failure word ({@code LOGIN_REQUIRED}) — fail closed, never bypassed. So
 * {@code READY} means 「이 계정으로 시작할 수 있습니다」, never 「성공할 것입니다」.
 *
 * <p>Whether the seller's own machine is running the helper is a fourth axis again, answered on the
 * seller's machine by the bridge and rendered from the same words the 도우미 card already uses.
 */
public enum ScreenReadReadiness {
    /** Every precondition this backend can check holds. */
    READY,
    /** This channel has no screen-read path — Cafe24 has an API and NAVER's path is an export. */
    CHANNEL_NOT_SUPPORTED,
    /** A file-upload account has no marketplace session to read. */
    FILE_UPLOAD_ACCOUNT,
    /**
     * No session slot: the account has never been bound to a helper. The handoff resolves the account
     * by slot, so a run started here would read the screen and then have nowhere to hand its reading.
     */
    HELPER_NOT_LINKED,
    /**
     * We cannot say which store this account IS, so nothing observed on the screen can be matched.
     *
     * <p>The expectation is the fingerprint of the {@code vendor_id} sealed in this account's
     * credential. Without it {@code assertWingStore} answers {@code UNRESOLVED / NO_EXPECTATION} and
     * the run stops without reading a row — which is the correct refusal and was, until this state
     * existed, delivered mid-run as 「어느 판매자 계정인지 확인하지 못했어요 … 판매자 화면이 정상적으로
     * 열려 있는지 확인한 뒤 다시 시도해 주세요」. Observed live on 2026-09-14: the seller's WING screen
     * was open and readable (the 업체코드 was observed), and the missing half was ours. A sentence that
     * sends someone to fix a screen that is not broken is worse than one that says nothing.
     *
     * <p>Answered by opening the vault — no marketplace request, on this path or behind it.
     */
    STORE_IDENTITY_UNKNOWN
}
