# GET /v1/pay-order/seller/product-orders - 조건형 상품 주문 상세 내역 조회

시간 범위와 상태 조건으로 상품 주문 상세 내역을 페이징 조회하는 endpoint로, 변경 이력이 아닌 현재 상태 기준의 스냅샷 조회에 사용합니다. 식별자를 모른 채 특정 기간의 발주 대기, 발송 대기, 클레임 진행 중 같은 운영 작업 큐를 만들고 싶을 때 productOrderStatuses, claimStatuses, placeOrderStatusType, fulfillment 같은 필터로 좁혀 사용하는 흐름이 일반적입니다. from은 필수이고 to를 생략하면 from으로부터 24시간 후까지가 자동 적용되며, rangeType으로 어떤 일시 기준(주문일·결제일·발송일 등)을 사용할지 지정합니다. pageSize는 1 이상 300 이하, page는 1 이상이어야 하며, 결과가 많을 때는 페이지를 끝까지 순회해 누락을 방지하되 페이지가 깊어질수록 데이터 변동 가능성이 커지므로 동기화 용도라면 last-changed-statuses 폴링 방식이 더 안전합니다. 수량 클레임 변경사항 개발 대응이 완료된 연동은 quantityClaimCompatibility=true로 호출해 응답 스키마를 새 형식으로 받아야 합니다. 400은 일시 형식이나 페이징 범위 오류, 500은 일시적 장애로 보고 traceId를 남긴 후 백오프 재시도와 무한 루프 방지를 적용합니다.

> Base URL: https://api.commerce.naver.com/external

### 요청 파라미터

| 이름 | 위치 | 타입 | 필수 | 설명 |
|------|------|------|:----:|------|
| from | query | string(date-time) | 필수 | 조회 기준의 시작 일시(inclusive) |
| to | query | string(date-time) |  | 조회 기준의 종료 일시(inclusive). 생략 시 from으로부터 24시간 후로 자동 지정됩니다. |
| rangeType | query | string |  |  |
| productOrderStatuses | query | array |  |  |
| claimStatuses | query | array |  |  |
| placeOrderStatusType | query | string |  |  |
| fulfillment | query | boolean |  | 풀필먼트 배송여부<br><br>값 \| 설명 \| 비고<br>-----\|-----\|------<br>null \| 풀필먼트 설정된 상품 여부를 구분하지 않고 상품주문 상세내역을 조회합니다. \|<br>false \| 풀필먼트 설정이 되지 않은 상품의 상품주문 상세내역을 조회합니다. \|<br>true \| 풀필먼트 설정된 상품의 상품주문 상세내역을 조회합니다. \| |
| pageSize | query | integer |  | 페이징 사이즈. 1 이상 300 이하 |
| page | query | integer |  | 페이지 번호. 최소 1 |
| quantityClaimCompatibility | query | boolean |  | 수량클레임 변경사항 개발 대응 완료 여부 (수량클레임 변경사항에 대한 개발 대응 완료 시 true 값으로 호출) |

### 응답 스키마

| 이름 | 위치 | 타입 | 필수 | 설명 |
|------|------|------|:----:|------|
| timestamp | - | string(date-time) |  |  |
| traceId | - | string | 필수 |  |
| data | - | object |  |  |
| data.contents | - | array |  |  |
| data.contents.… | - | - |  | 하위 구조 생략 (상세는 OAS 참조) |
| data.pagination | - | object |  | 페이징 정보 |
| data.pagination.… | - | - |  | 하위 구조 생략 (상세는 OAS 참조) |

### 에러 코드

| 상태 코드 | 설명 |
|-----------|------|
| 400 |  |
| 500 |  |

### 사용 enum 카탈로그

- 응답 `data.contents[].content.productOrder.shippingAddress.pickupLocationType`: `FRONT_OF_DOOR`, `MANAGEMENT_OFFICE`, `DIRECT_RECEIVE`, `OTHER`
- 응답 `data.contents[].content.productOrder.shippingAddress.entryMethod`: `LOBBY_PW`, `MANAGEMENT_OFFICE`, `FREE`, `OTHER`
- 응답 `data.contents[].content.productOrder.sellerBurdenMultiplePurchaseDiscountType`: `IGNORE_QUANTITY`, `QUANTITY`

### 호출 예시

```bash
curl -X GET 'https://api.commerce.naver.com/external/v1/pay-order/seller/product-orders?from={from}' \
  -H 'Authorization: Bearer {access_token}'
```