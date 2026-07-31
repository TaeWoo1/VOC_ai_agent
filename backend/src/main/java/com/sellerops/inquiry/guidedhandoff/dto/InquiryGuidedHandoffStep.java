package com.sellerops.inquiry.guidedhandoff.dto;

/**
 * One ordered step of the Guided Handoff checklist — the manual path the operator
 * follows on the Cafe24 admin to answer the inquiry themselves. Copy only; carries no
 * inquiry content, no id, and no link. A link, when available, is a separate optional
 * field on {@link InquiryGuidedHandoffView} and is never a substitute for these steps
 * (a link alone is never treated as completion).
 */
public record InquiryGuidedHandoffStep(int order, String instruction) {
}
