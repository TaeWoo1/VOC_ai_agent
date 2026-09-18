# (v2) 채널 상품 조회 — originProduct.detailAttribute 하위 구조 (발췌)

출처: NAVER 커머스API 센터가 공개한 API 레퍼런스 번들(`/docs/commerce-api/current/read-channel-product-1-product`의 스키마)에서 2026-09-18에 추출. `get-v2-products-channel-products-channelProductNo.md`가 「하위 구조 생략 (상세는 OAS 참조)」로 남긴 부분 중 Reviewnary가 투영하는 경로만 옮겼다. 상품정보제공고시 상품군별 필드 제목 전체는 `backend/src/main/resources/naver/product-info-notice-labels.tsv`에 같은 출처로 생성돼 있다.

| 경로 | 타입 | 제목 | 설명(앞부분) |
|---|---|---|---|
| originProduct.detailAttribute.naverShoppingSearchInfo | object | 네이버 쇼핑 검색 정보 | 네이버 쇼핑 검색 정보 |
| originProduct.detailAttribute.naverShoppingSearchInfo.modelName | string | 상품 모델명 |  |
| originProduct.detailAttribute.naverShoppingSearchInfo.manufacturerName | string | 제조사명 |  |
| originProduct.detailAttribute.naverShoppingSearchInfo.brandName | string | 브랜드명 |  |
| originProduct.detailAttribute.optionInfo | object | 옵션 정보 | 옵션 정보. 단독형 옵션, 조합형 옵션, 직접 입력형 옵션 중 최소 한 개는 입력해야 합니다. 렌탈 상품의 경우 조합형, 직접 입력형만 사용 가능합니다. - 단독형 옵션과 조합형 옵션은 함께 사용할 수 없습니다. |
| originProduct.detailAttribute.optionInfo.optionSimple | array | 단독형 옵션 | 최대 3개까지 등록할 수 있습니다. - 표준형 옵션, 단독형 옵션, 조합형 옵션, 직접 입력형 옵션 중 최소 한 개는 입력해야 합니다. - 표준형 옵션, 단독형 옵션과 조합형 옵션은 함께 사용할 수 없습니다. - 상품 수정 시 SKU가 연결된 표준형/조합형 옵션을 단독형 옵션으로 수정하 |
| originProduct.detailAttribute.optionInfo.optionSimple[].id | integer(int64) | 옵션 ID | 옵션 ID 입력 시 기존 옵션 수정 |
| originProduct.detailAttribute.optionInfo.optionSimple[].groupName | string | 옵션명 |  |
| originProduct.detailAttribute.optionInfo.optionSimple[].name | string | 옵션값 | "단독형 옵션"인 경우 입력합니다. "직접 입력형 옵션"인 경우 무시됩니다 |
| originProduct.detailAttribute.optionInfo.optionSimple[].usable | boolean | 사용 여부 | 미입력 시 사용 여부는 true로 설정됩니다. |
| originProduct.detailAttribute.optionInfo.optionCombinationGroupNames | object | 조합형 옵션명 | 조합형 옵션명 목록 |
| originProduct.detailAttribute.optionInfo.optionCombinationGroupNames.optionGroupName1 | string | 조합형 옵션명 1 |  |
| originProduct.detailAttribute.optionInfo.optionCombinationGroupNames.optionGroupName2 | string | 조합형 옵션명 2 |  |
| originProduct.detailAttribute.optionInfo.optionCombinationGroupNames.optionGroupName3 | string | 조합형 옵션명 3 |  |
| originProduct.detailAttribute.optionInfo.optionCombinationGroupNames.optionGroupName4 | string | 조합형 옵션명 4 | "지점형 옵션"인 경우만 대상. "조합형 옵션"인 경우 무시됩니다. |
| originProduct.detailAttribute.optionInfo.optionCombinations | array | 조합형 옵션 | 최대 등록 가능한 옵션 개수는 조합형은 3개, 지점형은 4개입니다. - 지금배달 상품의 경우 지점형 옵션은 반드시 등록해야 합니다. - 표준형 옵션, 단독형 옵션, 조합형 옵션, 직접 입력형 옵션 중 최소 한 개는 입력해야 합니다. - 표준형 옵션, 단독형 옵션, 조합형 옵션은 함께 사 |
| originProduct.detailAttribute.optionInfo.optionCombinations[].id | integer(int64) | 조합형 옵션 ID | - 상품 수정 시 - 옵션 ID를 입력한 경우, 옵션 ID의 옵션 정보를 수정합니다. - 옵션 ID를 입력하지 않은 경우, 옵션값의 옵션 정보를 수정합니다(해당 옵션값이 존재하지 않으면 옵션 신규 등록). - 지금배달, 퀵커머스 상품 수정 시 - 옵션값(optionName)에 기재된 지 |
| originProduct.detailAttribute.optionInfo.optionCombinations[].stockQuantity | integer(int32) | 재고 수량 | 미입력 시 0으로 설정됩니다. |
| originProduct.detailAttribute.optionInfo.optionCombinations[].price | integer(int32) | 옵션가 | 미입력 시 0으로 설정됩니다. |
| originProduct.detailAttribute.optionInfo.optionCombinations[].usable | boolean | 사용 여부 | 미입력 시 사용 여부는 true로 설정됩니다. |
| originProduct.detailAttribute.optionInfo.optionCombinations[].optionName1 | string | 조합형 옵션값 1 | combinationOptionNames의 옵션명 1에 해당하는 옵션값. 지금배달 계정 요청, 즉 지점 옵션(BRANCH)인 경우에는 옵션명이 아닌 지점 ID를 입력합니다. |
| originProduct.detailAttribute.optionInfo.optionCombinations[].optionName2 | string | 조합형 옵션값 2 | combinationOptionNames의 옵션명 2에 해당하는 옵션값 |
| originProduct.detailAttribute.optionInfo.optionCombinations[].optionName3 | string | 조합형 옵션값 3 | combinationOptionNames의 옵션명 3에 해당하는 옵션값 |
| originProduct.detailAttribute.optionInfo.optionCombinations[].optionName4 | string | 조합형 옵션값 4 | combinationOptionNames의 옵션명 4에 해당하는 옵션값. '지점형 옵션'인 경우만 대상. "조합형 옵션"인 경우 무시됩니다. |
| originProduct.detailAttribute.optionInfo.optionCombinations[].sellerManagerCode | string | 판매자 관리 코드 |  |
| originProduct.detailAttribute.optionInfo.useStockManagement | boolean | 옵션 재고 수량 관리 사용 여부 | '옵션 재고 수량 관리 사용 여부'를 입력하지 않거나 false로 지정하면 수량이 9,999로 설정됩니다. |
| originProduct.detailAttribute.supplementProductInfo | object | 추가 상품 | 추가 상품 정보 |
| originProduct.detailAttribute.supplementProductInfo.supplementProducts | array | 추가 상품 |  |
| originProduct.detailAttribute.supplementProductInfo.supplementProducts[].id | integer(int64) | 추가 상품 ID | 추가 상품 ID는 등록 또는 수정 후 생성되며, 그룹상품 조회 API의 응답에는 포함되지 않습니다. |
| originProduct.detailAttribute.supplementProductInfo.supplementProducts[].groupName | string | 추가 상품 그룹명 | 추가 상품명 |
| originProduct.detailAttribute.supplementProductInfo.supplementProducts[].name | string | 추가 상품명 | 추가 상품값 |
| originProduct.detailAttribute.supplementProductInfo.supplementProducts[].price | integer(int32) | 추가 상품가 | 미입력 시 0원으로 입력됩니다. |
| originProduct.detailAttribute.supplementProductInfo.supplementProducts[].stockQuantity | integer(int32) | 재고 수량 | 미입력 시 0개로 입력됩니다. |
| originProduct.detailAttribute.supplementProductInfo.supplementProducts[].sellerManagementCode | string | 판매자 관리 코드 |  |
| originProduct.detailAttribute.supplementProductInfo.supplementProducts[].usable | boolean | 사용 여부 | 미입력 시 true로 입력됩니다. |
| originProduct.detailAttribute.productAttributes | array | 상품 속성 목록 |  |
| originProduct.detailAttribute.productAttributes[].attributeSeq | integer(int64) | 속성 ID |  |
| originProduct.detailAttribute.productAttributes[].attributeValueSeq | integer(int64) | 속성값 ID |  |
| originProduct.detailAttribute.productAttributes[].attributeRealValue | string | 속성 실제 값 | 범위형인 경우 입력합니다. 범위형처럼 속성의 특정 값을 지정할 수 없을 때 사용합니다. |
| originProduct.detailAttribute.productAttributes[].attributeRealValueUnitCode | string | 속성 실제 값 단위 코드 | 범위형인 경우 입력합니다. |
| originProduct.detailAttribute.seoInfo | object | SEO(Search engine optimization) 정보 | SEO(Search engine optimization) 정보 |
| originProduct.detailAttribute.seoInfo.sellerTags | array | 판매자 입력 태그 |  |
| originProduct.detailAttribute.seoInfo.sellerTags[].code | integer(int64) | 태그 ID | 태그 ID는 추천 태그 조회 API를 통해 확인할 수 있습니다. 입력한 태그 ID와 태그명이 일치하지 않는 경우 요청은 실패합니다. 추천 태그가 아닌 직접 입력 태그의 경우 태그 ID(code)는 입력하지 않습니다. |
| originProduct.detailAttribute.seoInfo.sellerTags[].text | string | 태그명 |  |
| originProduct.detailAttribute.productInfoProvidedNotice.productInfoProvidedNoticeType | string | 상품정보제공고시 상품군 유형 | 상품 요약 정보를 나타내는 타입입니다. 하위 요소 중 하나를 선택해서 입력해야 하며 입력한 타입의 필드 정보가 등록됩니다. - WEAR(의류 상품 요약 정보, wear 필드에 정보 입력) - SHOES(구두/신발 상품 요약 정보, shoes 필드에 정보 입
| originProduct.detailAttribute.productInfoProvidedNotice.kitchenUtensils | object | 주방용품 상품정보제공고시 | 주방용품 상품정보제공고시 |
| originProduct.detailAttribute.productInfoProvidedNotice.kitchenUtensils.returnCostReason | string | 제품하자/오배송에 따른 청약철회 조항 | 제품하자ㆍ오배송 등에 따른 청약철회 등의 경우 청약철회 등의 기한 및 통신판매업자가 부담하는 반품 비용 등에 관한 정보. 미입력 시 상품상세 참조로 입력됩니다. - 0 (전자상거래등에서의소비자보호에관한법률 등에 의한 제품의 하자 또는 오배송 
| originProduct.detailAttribute.productInfoProvidedNotice.kitchenUtensils.noRefundReason | string | 제품하자가 아닌 소비자의 단순변심에 따른 청약철회가 불가능한 경우 그 구체적 사유와 근거 | 미입력 시 상품상세 참조로 입력됩니다. - 0 (전자상거래 등에서의 소비자보호에 관한 법률 등에 의한 청약철회 제한 사유에 해당하는 경우 및 기타 객관적으로 이에 준하는 것으로 인정되는 경우 청
| originProduct.detailAttribute.productInfoProvidedNotice.kitchenUtensils.qualityAssuranceStandard | string | 재화 등의 교환ㆍ반품ㆍ보증 조건 및 품질 보증 기준 | 미입력 시 상품상세 참조로 입력됩니다. - 0 (소비자분쟁해결기준(공정거래위원회 고시) 및 관계법령에 따릅니다.) - 1 (상품상세 참조) |
| originProduct.detailAttribute.productInfoProvidedNotice.kitchenUtensils.compensationProcedure | string | 대금을 환불받기 위한 방법과 환불이 지연될 경우 지연배상금을 지급받을 수 있다는 사실 및 배상금 지급의 구체적인 조건·절차 | 미입력 시 상품상세 참조로 입력됩니다. - 0 (주문취소 및 대금의 환불은 네이버페이 마이페이지에서 신청할 수 있으며, 전자상거래 등에서의 소비자보
| originProduct.detailAttribute.productInfoProvidedNotice.kitchenUtensils.troubleShootingContents | string | 소비자피해보상의 처리, 재화 등에 대한 불만 처리 및 소비자와 사업자 사이의 분쟁 처리에 관한 사항 | 미입력 시 상품상세 참조로 입력됩니다. - 0 (소비자분쟁해결기준(공정거래위원회 고시) 및 관계법령에 따릅니다.) - 1 (상품상세 참조) |
| originProduct.detailAttribute.productInfoProvidedNotice.kitchenUtensils.itemName | string | 품명 |  |
| originProduct.detailAttribute.productInfoProvidedNotice.kitchenUtensils.modelName | string | 모델명 |  |
| originProduct.detailAttribute.productInfoProvidedNotice.kitchenUtensils.material | string | 재질 |  |
| originProduct.detailAttribute.productInfoProvidedNotice.kitchenUtensils.component | string | 구성품 |  |
| originProduct.detailAttribute.productInfoProvidedNotice.kitchenUtensils.size | string | 크기 |  |
| originProduct.detailAttribute.productInfoProvidedNotice.kitchenUtensils.releaseDate | string('yyyy-MM' 형식 입력) | 출시연월 |  |
| originProduct.detailAttribute.productInfoProvidedNotice.kitchenUtensils.releaseDateText | string(releaseDate를 입력하지 않은 경우에는 필수) | 동일 모델 출시연월 직접 입력 |  |
| originProduct.detailAttribute.productInfoProvidedNotice.kitchenUtensils.manufacturer | string | 제조자(사) |  |
| originProduct.detailAttribute.productInfoProvidedNotice.kitchenUtensils.producer | string | 제조국 |  |
| originProduct.detailAttribute.productInfoProvidedNotice.kitchenUtensils.importDeclaration | boolean(미입력 시 false로 설정됩니다. true: 수입식품안전관리특별법에 따른 수입신고를 필함. false: 해당 사항 없음) | 수입식품안전관리특별법에 따른 수입신고 | ｢수입식품안전관리 특별법｣에 따른 수입기구 또는 용기·포장의 경우 |
| originProduct.detailAttribute.productInfoProvidedNotice.kitchenUtensils.warrantyPolicy | string | 품질 보증 기준 |  |
| originProduct.detailAttribute.productInfoProvidedNotice.kitchenUtensils.afterServiceDirector | string | A/S 책임자와 전화번호 |  |
| originProduct.detailAttribute.productInfoProvidedNotice.etc | object | 기타 재화 상품정보제공고시 | 기타 재화 상품정보제공고시 |
| originProduct.detailAttribute.productInfoProvidedNotice.etc.returnCostReason | string | 제품하자/오배송에 따른 청약철회 조항 | 제품하자ㆍ오배송 등에 따른 청약철회 등의 경우 청약철회 등의 기한 및 통신판매업자가 부담하는 반품 비용 등에 관한 정보. 미입력 시 상품상세 참조로 입력됩니다. - 0 (전자상거래등에서의소비자보호에관한법률 등에 의한 제품의 하자 또는 오배송 등으로 인한 청약철회의
| originProduct.detailAttribute.productInfoProvidedNotice.etc.noRefundReason | string | 제품하자가 아닌 소비자의 단순변심에 따른 청약철회가 불가능한 경우 그 구체적 사유와 근거 | 미입력 시 상품상세 참조로 입력됩니다. - 0 (전자상거래 등에서의 소비자보호에 관한 법률 등에 의한 청약철회 제한 사유에 해당하는 경우 및 기타 객관적으로 이에 준하는 것으로 인정되는 경우 청약철회가 제한될 수 있
| originProduct.detailAttribute.productInfoProvidedNotice.etc.qualityAssuranceStandard | string | 재화 등의 교환ㆍ반품ㆍ보증 조건 및 품질 보증 기준 | 미입력 시 상품상세 참조로 입력됩니다. - 0 (소비자분쟁해결기준(공정거래위원회 고시) 및 관계법령에 따릅니다.) - 1 (상품상세 참조) |
| originProduct.detailAttribute.productInfoProvidedNotice.etc.compensationProcedure | string | 대금을 환불받기 위한 방법과 환불이 지연될 경우 지연배상금을 지급받을 수 있다는 사실 및 배상금 지급의 구체적인 조건·절차 | 미입력 시 상품상세 참조로 입력됩니다. - 0 (주문취소 및 대금의 환불은 네이버페이 마이페이지에서 신청할 수 있으며, 전자상거래 등에서의 소비자보호에 관한 법률에 따라
| originProduct.detailAttribute.productInfoProvidedNotice.etc.troubleShootingContents | string | 소비자피해보상의 처리, 재화 등에 대한 불만 처리 및 소비자와 사업자 사이의 분쟁 처리에 관한 사항 | 미입력 시 상품상세 참조로 입력됩니다. - 0 (소비자분쟁해결기준(공정거래위원회 고시) 및 관계법령에 따릅니다.) - 1 (상품상세 참조) |
| originProduct.detailAttribute.productInfoProvidedNotice.etc.itemName | string | 품명 |  |
| originProduct.detailAttribute.productInfoProvidedNotice.etc.modelName | string | 모델명 |  |
| originProduct.detailAttribute.productInfoProvidedNotice.etc.certificateDetails | string(해당 사항이 없으면 이 요소를 삭제하고 전송합니다.) | 법에 의한 인증, 허가 등을 받았음을 확인할 수 있는 경우 그에 대한 사항 |  |
| originProduct.detailAttribute.productInfoProvidedNotice.etc.manufacturer | string | 제조자(사) |  |
| originProduct.detailAttribute.productInfoProvidedNotice.etc.afterServiceDirector | string | A/S 책임자 |  |
| originProduct.detailAttribute.productInfoProvidedNotice.etc.customerServicePhoneNumber | string(afterServiceDirector를 입력하지 않은 경우에는 필수) | 소비자 상담 관련 전화번호 |  |
