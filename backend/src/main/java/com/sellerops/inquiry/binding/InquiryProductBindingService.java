package com.sellerops.inquiry.binding;

import com.sellerops.common.ApiException;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryProductBinding;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.binding.dto.InquiryProductBindingView;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.product.OperatorProductName;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.user.User;
import com.sellerops.user.UserRepository;
import java.time.Instant;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Letting a person say which product an inquiry is about, when the channel would not.
 *
 * <p><b>Why this exists, in numbers.</b> Cafe24's 문의 board carries a product identifier on almost
 * none of its articles: of the canonical Demo Org's 3,312 REAL Cafe24 inquiries, 5 are attributable
 * exactly and 3,307 are honestly unattributed. Guessing the rest from the inquiry text — by name
 * similarity, by an LLM, by picking the first candidate — is forbidden, and rightly: an answer
 * grounded in the wrong product's knowledge is worse than an answer that admits it has none. What is
 * left is to ask the person who already knows.
 *
 * <p><b>What this refuses to do.</b> It never proposes a product, never ranks candidates by anything
 * but the seller's own search, and never binds without an explicit product id from the screen. The
 * seller's answer is stored as {@link InquiryProductBinding#USER_CONFIRMED} — a different fact from a
 * source match, kept in a different value, so nothing downstream can mistake one for the other.
 *
 * <p><b>What it refuses to overwrite.</b> A binding the SOURCE made stands until someone says twice
 * that it is wrong ({@code override}). The channel's own identifier matched a listing in
 * {@code channel_products}; a person overruling that is making a claim about the channel's data, and
 * it should cost one more click than agreeing with it.
 */
@Service
public class InquiryProductBindingService {

    /** Replacing a source-matched attribution needs {@code override}; this is what says so. */
    public static final String SOURCE_BINDING_EXISTS = "SOURCE_BINDING_EXISTS";

    private final InquiryWorkItemRepository workItems;
    private final InquiryRepository inquiries;
    private final ProductRepository products;
    private final UserRepository users;
    private final InquiryProductBindingEventRepository events;

    public InquiryProductBindingService(InquiryWorkItemRepository workItems,
                                        InquiryRepository inquiries,
                                        ProductRepository products,
                                        UserRepository users,
                                        InquiryProductBindingEventRepository events) {
        this.workItems = workItems;
        this.inquiries = inquiries;
        this.products = products;
        this.users = users;
        this.events = events;
    }

    /** The current attribution of the inquiry behind this work item. */
    @Transactional(readOnly = true)
    public InquiryProductBindingView current(UUID orgId, UUID workItemId) {
        return view(inquiry(orgId, workItemId));
    }

    /**
     * Bind this inquiry to a product the seller picked.
     *
     * <p>Cross-org is a 404, not a 403: an org that does not own a product should not learn that it
     * exists. Re-binding to the product already bound is idempotent and records nothing — a person
     * confirming what is already true has not changed anything.
     */
    @Transactional
    public InquiryProductBindingView bind(UUID orgId, UUID workItemId, UUID productId,
                                          boolean override, UUID actorUserId) {
        Inquiry inquiry = inquiry(orgId, workItemId);
        Product product = products.findById(productId)
                .filter(p -> orgId.equals(p.getOrgId()))
                .orElseThrow(() -> ApiException.notFound("상품을 찾을 수 없습니다."));
        if (OperatorProductName.displayNameOrNull(product) == null) {
            // Ingest's shared "(미지정 상품)" bucket and its number-named leftovers are rows, not
            // products. Binding an inquiry to one would give it a library nobody wrote.
            throw ApiException.conflict("이름이 확인되지 않은 상품에는 문의를 연결할 수 없습니다.");
        }
        UUID previousProduct = inquiry.getProductId();
        InquiryProductBinding previousBinding = inquiry.productBinding();
        if (productId.equals(previousProduct)
                && previousBinding == InquiryProductBinding.USER_CONFIRMED) {
            return view(inquiry);
        }
        if (previousBinding == InquiryProductBinding.SOURCE_EXACT
                && !productId.equals(previousProduct) && !override) {
            throw ApiException.conflict(SOURCE_BINDING_EXISTS,
                    "이 문의는 채널이 알려준 상품 번호로 이미 연결돼 있습니다. 바꾸려면 확인이 한 번 더 필요합니다.");
        }
        String actorName = users.findById(actorUserId).map(User::getName).orElse(null);

        InquiryProductBindingEvent event = new InquiryProductBindingEvent();
        event.setOrgId(orgId);
        event.setInquiryId(inquiry.getId());
        event.setPreviousProductId(previousProduct);
        event.setPreviousBinding(previousBinding == null ? null : previousBinding.name());
        event.setProductId(productId);
        event.setBinding(InquiryProductBinding.USER_CONFIRMED.name());
        event.setActorUserId(actorUserId);
        event.setActorName(actorName);
        events.save(event);

        inquiry.setProductId(productId);
        inquiry.setProductBinding(InquiryProductBinding.USER_CONFIRMED.name());
        inquiry.setProductBoundAt(Instant.now());
        inquiry.setProductBoundBy(actorUserId);
        inquiries.save(inquiry);
        return view(inquiry);
    }

    private Inquiry inquiry(UUID orgId, UUID workItemId) {
        InquiryWorkItem workItem = workItems.findById(workItemId)
                .filter(w -> orgId.equals(w.getOrgId()))
                .orElseThrow(() -> ApiException.notFound("문의 작업을 찾을 수 없습니다."));
        return inquiries.findById(workItem.getInquiryId())
                .filter(i -> orgId.equals(i.getOrgId()))
                .orElseThrow(() -> ApiException.notFound("문의를 찾을 수 없습니다."));
    }

    private InquiryProductBindingView view(Inquiry inquiry) {
        UUID productId = inquiry.getProductId();
        String name = productId == null ? null
                : products.findById(productId).map(OperatorProductName::displayNameOrNull).orElse(null);
        InquiryProductBinding binding = inquiry.productBinding();
        String boundBy = inquiry.getProductBoundBy() == null ? null
                : users.findById(inquiry.getProductBoundBy()).map(User::getName).orElse(null);
        return new InquiryProductBindingView(inquiry.getId(), productId, name,
                binding == null ? null : binding.name(), inquiry.getProductBoundAt(), boundBy,
                inquiry.getSourceProductRef());
    }
}
