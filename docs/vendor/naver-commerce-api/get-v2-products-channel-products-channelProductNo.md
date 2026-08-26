# GET /v2/products/channel-products/{channelProductNo} - (v2) 채널 상품 조회

(v2) 채널 상품 조회 API는 channelProductNo를 path 파라미터로 지정해 특정 채널 상품의 전체 정보를 조회하기 위한 엔드포인트로, v2 에서는 상품 모델이 원상품(공통 속성) 과 채널 상품(스마트스토어·쇼핑윈도) 으로 분리되어 응답에 originProduct·smartstoreChannelProduct·windowChannelProduct 가 함께 노출됩니다. 그룹상품으로 등록된 상품의 경우 groupProduct 정보가 함께 반환되므로, 운영 화면에서 상품 한 건의 통합 상세를 표시하거나 외부 시스템과 동기화할 때 본 API 를 단일 진입점으로 사용합니다. 응답은 카테고리·이미지·가격·재고·배송·인증·고객 혜택·전시 상태 등 광범위한 속성을 포함하므로 호출 후 사용 영역에 필요한 항목만 선별해 가공하는 것이 효율적이며, 응답 필드의 enum 값(statusType·deliveryType·taxType 등) 은 OAS 에 정의된 코드를 기준으로 매핑합니다. channelProductNo 가 누락되거나 형식이 잘못되면 400 BAD_REQUEST, 인증이 유효하지 않으면 401 UNAUTHORIZED, 접근 권한이 없으면 403 FORBIDDEN, 존재하지 않는 상품을 지정하면 404 NOT_FOUND 가 반환되므로 호출자 계정의 판매자 권한과 채널 매핑을 먼저 확인해야 합니다. 500 응답은 일시 장애 가능성이 있어 지수 백오프 재시도로 대응합니다. 308 응답이 반환되면 리다이렉트 대상 위치로 재요청해야 하며, 리다이렉트가 반복되지 않도록 최대 재시도 횟수를 두고 처리합니다. 원상품 식별자만 알고 있는 경우에는 원상품 조회 API를 사용해 동일 정보를 channel 관점이 아닌 origin 관점으로 받아올 수 있습니다.

> Base URL: https://api.commerce.naver.com/external

### 요청 파라미터

| 이름 | 위치 | 타입 | 필수 | 설명 |
|------|------|------|:----:|------|
| channelProductNo | path | integer(int64) | 필수 |  |

### 응답 스키마

| 이름 | 위치 | 타입 | 필수 | 설명 |
|------|------|------|:----:|------|
| groupProduct | - | object |  | 그룹상품으로 등록, 설정한 상품의 경우 조회됩니다. |
| groupProduct.groupProductNo | - | integer(int64) |  |  |
| groupProduct.leafCategoryId | - | string |  |  |
| groupProduct.groupProductName | - | string |  |  |
| originProduct | - | object |  | 응답용 원상품 정보. 원상품에 속한 채널 상품은 모두 상품 공통 속성을 참고합니다.<br>이 구조체는 상품 정보 중 원상품 속성에 해당하는 상품 데이터를 표현하는 구조체입니다.<br>- 이 구조체는 API 호출에 대한 요청/응답 모두에서 사용합니다.<br>- 구조체의 객체 1개는 상품 1개에 대한 원상품 정보를 표현합니다.<br>- 상품 단위별로 원상품 정보는 단일 구조체로만 포함되나 계층 구조상 자매 개체로 스마트스토어 채널 상품 구조체 혹은 쇼핑윈도 채널 상품 구조체와 함께 사용할 수 있습니다.<br>- 이 구조체는 아래 API에서 사용합니다.<br>  - 상품 등록, 채널 상품 조회, 채널 상품 수정, 원상품 조회, 원상품 수정 등 |
| originProduct.statusType | - | string | 필수 | 허용값: `WAIT`, `SALE`, `OUTOFSTOCK`, `UNADMISSION`, `REJECTION`, `SUSPENSION`, `CLOSE`, `PROHIBITION`, `DELETE` |
| originProduct.saleType | - | string |  | 허용값: `NEW`, `OLD` |
| originProduct.leafCategoryId | - | string |  |  |
| originProduct.name | - | string | 필수 |  |
| originProduct.detailContent | - | string | 필수 |  |
| originProduct.images | - | object | 필수 | 상품 이미지로 대표 이미지(1000x1000픽셀 권장)와 최대 9개의 추가 이미지 목록을 제공할 수 있습니다. 대표 이미지는 필수이고 추가 이미지는 선택 사항입니다.<br><b>이미지 URL은 반드시 상품 이미지 다건 등록 API로 이미지를 업로드하고 반환받은 URL 값을 입력해야 합니다.</b> |
| originProduct.images.… | - | - |  | 하위 구조 생략 (상세는 OAS 참조) |
| originProduct.saleStartDate | - | string(date-time) |  | 'yyyy-MM-dd'T'HH:mm[:ss][.SSS]XXX' 형식으로 입력합니다. |
| originProduct.saleEndDate | - | string(date-time) |  | 'yyyy-MM-dd'T'HH:mm[:ss][.SSS]XXX' 형식으로 입력합니다. |
| originProduct.salePrice | - | integer(int64) | 필수 | 최대 999999990 |
| originProduct.stockQuantity | - | integer(int32) |  | 최대 99999999 |
| originProduct.deliveryInfo | - | object |  | 배송 방식 및 배송비 등을 설정할 수 있습니다. 입력하지 않으면 배송 없는 상품으로 등록됩니다.<br>렌탈 또는 지금배달 상품의 경우에는 배송 정보를 필수로 입력해야 합니다. |
| originProduct.deliveryInfo.… | - | - |  | 하위 구조 생략 (상세는 OAS 참조) |
| originProduct.productLogistics | - | array |  | 네이버 풀필먼트가 설정된 상품의 경우 조회됩니다. |
| originProduct.productLogistics.… | - | - |  | 하위 구조 생략 (상세는 OAS 참조) |
| originProduct.detailAttribute | - | object | 필수 | 조회용 원상품 상세 속성 |
| originProduct.detailAttribute.… | - | - |  | 하위 구조 생략 (상세는 OAS 참조) |
| originProduct.customerBenefit | - | object |  | 응답용 상품 고객 혜택 정보 |
| originProduct.customerBenefit.… | - | - |  | 하위 구조 생략 (상세는 OAS 참조) |
| smartstoreChannelProduct | - | object |  | 이 구조체는 상품 정보 중 스마트스토어 채널 상품 속성에 해당하는 상품 데이터를 표현하는 구조체입니다.<br> - 이 구조체는 API 호출에 대한 요청/응답 모두에서 사용합니다.<br> - 구조체의 객체 1개는 상품 1개에 대한 스마트스토어 채널 상품 정보를 표현합니다.<br> - 상품 단위별로 스마트스토어 채널 상품 정보는 단일 구조체로만 포함되나 계층 구조상 자매 개체로 원상품 구조체 혹은 쇼핑윈도 채널 상품 구조체와 함께 사용할 수 있습니다.<br> - 이 구조체는 아래 API에서 사용합니다.<br>   - 상품 등록, 채널 상품 조회, 채널 상품 수정, 원상품 조회, 원상품 수정 등 |
| smartstoreChannelProduct.channelProductName | - | string |  | 채널 상품 전용 상품명을 사용하는 경우 입력합니다. 미입력 시 원상품명으로 적용됩니다. |
| smartstoreChannelProduct.bbsSeq | - | integer(int64) |  | 공지사항 |
| smartstoreChannelProduct.storeKeepExclusiveProduct | - | boolean |  | 미입력 시 false로 저장됩니다. |
| smartstoreChannelProduct.naverShoppingRegistration | - | boolean | 필수 | 네이버 쇼핑 광고주가 아닌 경우에는 false로 저장됩니다. |
| smartstoreChannelProduct.channelProductDisplayStatusType | - | string | 필수 | ON, SUSPENSION만 입력 가능합니다.<br>- WAIT(전시 대기), ON(전시 중), SUSPENSION(전시 중지). 허용값: `WAIT`, `ON`, `SUSPENSION` |
| windowChannelProduct | - | object |  | 이 구조체는 상품 정보 중 쇼핑윈도 채널 상품 속성에 해당하는 상품 데이터를 표현하는 구조체입니다.<br>- 이 구조체는 API 호출에 대한 요청/응답 모두에서 사용합니다.<br>- 구조체의 객체 1개는 상품 1개에 대한 쇼핑윈도 채널 상품 정보를 표현합니다.<br>- 상품 단위별로 쇼핑윈도 채널 상품 정보는 단일 구조체로만 포함되나 계층 구조상 자매 개체로 원상품 구조체 혹은 스마트스토어 채널 상품 구조체와 함께 사용할 수 있습니다.<br>- 이 구조체는 아래 API에서 사용합니다.<br>  - 상품 등록, 채널 상품 조회, 채널 상품 수정, 원상품 조회, 원상품 수정 등 |
| windowChannelProduct.channelProductName | - | string |  | 채널 상품 전용 상품명을 사용하는 경우 입력합니다. 미입력 시 원상품명으로 적용됩니다. |
| windowChannelProduct.bbsSeq | - | integer(int64) |  | 공지사항 |
| windowChannelProduct.storeKeepExclusiveProduct | - | boolean |  | 미입력 시 false로 저장됩니다. |
| windowChannelProduct.naverShoppingRegistration | - | boolean | 필수 | 네이버 쇼핑 광고주가 아닌 경우에는 false로 저장됩니다. |
| windowChannelProduct.channelNo | - | integer(int64) | 필수 | 전시할 윈도 채널 선택 |
| windowChannelProduct.best | - | boolean |  | 미입력 시 false로 저장됩니다. |
| windowChannelProduct.channelProductDisplayStatusType | - | string |  | WAIT(전시 대기), ON(전시 중), SUSPENSION(전시 중지). 허용값: `WAIT`, `ON`, `SUSPENSION` |

### 에러 코드

| 상태 코드 | 설명 |
|-----------|------|
| 400 | 잘못된 요청<br/>- code : BAD_REQUEST |
| 401 | 인가되지 않은 요청<br/>- code : UNAUTHORIZED |
| 403 | 권한 없음<br/>- code : FORBIDDEN |
| 404 | 데이터 없음<br/>- code : NOT_FOUND |
| 500 | 내부 서버 오류<br/>- code : INTERNAL_SERVER_ERROR |

### 사용 enum 카탈로그

- 응답 `originProduct.statusType`: `WAIT`, `SALE`, `OUTOFSTOCK`, `UNADMISSION`, `REJECTION`, `SUSPENSION`, `CLOSE`, `PROHIBITION`, `DELETE`
- 응답 `originProduct.saleType`: `NEW`, `OLD`
- 응답 `originProduct.deliveryInfo.deliveryType`: `DELIVERY`, `DIRECT`
- 응답 `originProduct.deliveryInfo.deliveryAttributeType`: `NORMAL`, `TODAY`, `OPTION_TODAY`, `HOPE`, `TODAY_ARRIVAL`, `DAWN_ARRIVAL`, `ARRIVAL_GUARANTEE`, `SELLER_GUARANTEE`, `HOPE_SELLER_GUARANTEE`, `QUICK`, `PICKUP`, `QUICK_PICKUP`
- 응답 `originProduct.deliveryInfo.quickServiceAreas[]`: `SEOUL`, `GYEONGGI`, `GOYANG`, `GOCHON`, `GONJIAM`, `GWACHEON`, `GWANGMYEONG`, `GYEONGGIGWANGJU`, `GYOMUN`, `GURI`, `GUSEONG`, `GUNPO`, `GIMPO`, `BUCHEON`, `BUNDANG`, `SEONGNAM`, `SUWON`, `SUJI`, `SIHEUNG`, `ANSAN`, `ANYANG`, `YONGIN`, `UIWANG`, `UIJEONGBU`, `ICHEON`, `ILSAN`, `JICHUK`, `PAJU`, `HANAM`, `GWANGJU`, `DAEGU`, `DAEJEON`, `BUSAN`, `ULSAN`, `INCHEON`
- 응답 `originProduct.deliveryInfo.deliveryFee.deliveryFeeType`: `FREE`, `CONDITIONAL_FREE`, `PAID`, `UNIT_QUANTITY_PAID`, `RANGE_QUANTITY_PAID`
- 응답 `originProduct.deliveryInfo.deliveryFee.deliveryFeePayType`: `COLLECT`, `PREPAID`, `COLLECT_OR_PREPAID`
- 응답 `originProduct.deliveryInfo.deliveryFee.deliveryFeeByArea.deliveryAreaType`: `AREA_2`, `AREA_3`
- 응답 `originProduct.deliveryInfo.claimDeliveryInfo.returnDeliveryCompanyPriorityType`: `PRIMARY`, `SECONDARY_1`, `SECONDARY_2`, `SECONDARY_3`, `SECONDARY_4`, `SECONDARY_5`, `SECONDARY_6`, `SECONDARY_7`, `SECONDARY_8`, `SECONDARY_9`
- 응답 `originProduct.deliveryInfo.expectedDeliveryPeriodType`: `ETC`, `TWO`, `THREE`, `FOUR`, `FIVE`, `SIX`, `SEVEN`, `EIGHT`, `NINE`, `TEN`, `ELEVEN`, `TWELVE`, `THIRTEEN`, `FOURTEEN`
- 응답 `originProduct.detailAttribute.optionInfo.simpleOptionSortType`: `CREATE`, `ABC`, `LOW_PRICE`, `HIGH_PRICE`
- 응답 `originProduct.detailAttribute.optionInfo.optionCombinationSortType`: `CREATE`, `ABC`, `LOW_PRICE`, `HIGH_PRICE`
- 응답 `originProduct.detailAttribute.supplementProductInfo.sortType`: `CREATE`, `ABC`, `LOW_PRICE`, `HIGH_PRICE`
- 응답 `originProduct.detailAttribute.taxType`: `TAX`, `DUTYFREE`, `SMALL`
- 응답 `originProduct.detailAttribute.customsTaxType`: `NOT_APPLICABLE`, `INCLUDED`, `EXCLUDED`
- 응답 `originProduct.detailAttribute.productCertificationInfos[].certificationKindType`: `KC_CERTIFICATION`, `CHILD_CERTIFICATION`, `GREEN_PRODUCTS`, `CHEMICAL_CERTIFICATION`, `PARALLEL_IMPORT`, `OVERSEAS`, `ETC`
- 응답 `originProduct.detailAttribute.certificationTargetExcludeContent.kcExemptionType`: `OVERSEAS`, `SAFE_CRITERION`, `PARALLEL_IMPORT`
- 응답 `originProduct.detailAttribute.certificationTargetExcludeContent.kcCertifiedProductExclusionYn`: `FALSE`, `KC_EXEMPTION_OBJECT`, `TRUE`
- 응답 `originProduct.detailAttribute.ecoupon.periodType`: `FIXED`, `FLEXIBLE`
- 응답 `originProduct.detailAttribute.ecoupon.usePlaceType`: `PLACE`, `ADDRESS`, `URL`
- 응답 `originProduct.detailAttribute.productInfoProvidedNotice.productInfoProvidedNoticeType`: `WEAR`, `SHOES`, `BAG`, `FASHION_ITEMS`, `SLEEPING_GEAR`, `FURNITURE`, `IMAGE_APPLIANCES`, `HOME_APPLIANCES`, `SEASON_APPLIANCES`, `OFFICE_APPLIANCES`, `OPTICS_APPLIANCES`, `MICROELECTRONICS`, `CELLPHONE`, `NAVIGATION`, `CAR_ARTICLES`, `MEDICAL_APPLIANCES`, `KITCHEN_UTENSILS`, `COSMETIC`, `JEWELLERY`, `FOOD`, `GENERAL_FOOD`, `DIET_FOOD`, `KIDS`, `MUSICAL_INSTRUMENT`, `SPORTS_EQUIPMENT`, `BOOKS`, `LODGMENT_RESERVATION`, `TRAVEL_PACKAGE`, `AIRLINE_TICKET`, `RENT_CAR`, `RENTAL_HA`, `RENTAL_ETC`, `DIGITAL_CONTENTS`, `GIFT_CARD`, `MOBILE_COUPON`, `MOVIE_SHOW`, `ETC_SERVICE`, `BIOCHEMISTRY`, `BIOCIDAL`, `ETC`
- 응답 `originProduct.detailAttribute.productInfoProvidedNotice.seasonAppliances.releaseDate.month`: `JANUARY`, `FEBRUARY`, `MARCH`, `APRIL`, `MAY`, `JUNE`, `JULY`, `AUGUST`, `SEPTEMBER`, `OCTOBER`, `NOVEMBER`, `DECEMBER`
- 응답 `originProduct.detailAttribute.productInfoProvidedNotice.officeAppliances.releaseDate.month`: `JANUARY`, `FEBRUARY`, `MARCH`, `APRIL`, `MAY`, `JUNE`, `JULY`, `AUGUST`, `SEPTEMBER`, `OCTOBER`, `NOVEMBER`, `DECEMBER`
- 응답 `originProduct.detailAttribute.productInfoProvidedNotice.sportsEquipment.releaseDate.month`: `JANUARY`, `FEBRUARY`, `MARCH`, `APRIL`, `MAY`, `JUNE`, `JULY`, `AUGUST`, `SEPTEMBER`, `OCTOBER`, `NOVEMBER`, `DECEMBER`
- 응답 `originProduct.detailAttribute.preOrder.preOrderEndSaleStatus`: `SALE_END`, `ON_SALE`
- 응답 `originProduct.customerBenefit.immediateDiscountPolicy.discountMethod.unitType`: `PERCENT`, `WON`, `YEN`, `COUNT`
- 응답 `originProduct.customerBenefit.purchasePointPolicy.unitType`: `PERCENT`, `WON`, `YEN`, `COUNT`
- 응답 `originProduct.customerBenefit.multiPurchaseDiscountPolicy.discountMethod.unitType`: `PERCENT`, `WON`, `YEN`, `COUNT`
- 응답 `originProduct.customerBenefit.multiPurchaseDiscountPolicy.orderValueUnitType`: `PERCENT`, `WON`, `YEN`, `COUNT`
- 응답 `originProduct.customerBenefit.reservedDiscountPolicy.discountMethod.unitType`: `PERCENT`, `WON`, `YEN`, `COUNT`
- 응답 `originProduct.customerBenefit.promotionDiscountPolicies[].discountMethod.unitType`: `PERCENT`, `WON`, `YEN`, `COUNT`
- 응답 `smartstoreChannelProduct.channelProductDisplayStatusType`: `WAIT`, `ON`, `SUSPENSION`
- 응답 `windowChannelProduct.channelProductDisplayStatusType`: `WAIT`, `ON`, `SUSPENSION`

### 호출 예시

```bash
curl -X GET 'https://api.commerce.naver.com/external/v2/products/channel-products/{channelProductNo}' \
  -H 'Authorization: Bearer {access_token}'
```
