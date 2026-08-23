# GET /v1/pay-user/inquiries - 고객 문의 조회

이 endpoint 는 네이버페이 구매회원으로 등록된 본인 계정에 누적된 고객 문의를 일자 범위로 페이징 조회하는 endpoint 로, 답변 처리 모니터링이나 CS 워크플로우 자동화의 입력 데이터로 사용됩니다. startSearchDate, endSearchDate 는 yyyy-MM-dd 형식의 필수 파라미터로 문의 등록일을 기준으로 좁히는 데 사용하며, answered 를 false 로 두면 미답변 문의만, true 로 두면 답변 완료 문의만 가져와 답변 누락 모니터링과 답변 품질 점검을 분리하기 쉽습니다. size 는 페이지당 10~200, page 는 1~1000000 범위이므로 대량 적재 시에는 size 를 충분히 키워 호출 수를 줄이고, totalPages 와 last 필드를 활용해 종료 조건을 안전하게 판정합니다. 응답의 content 배열에는 문의 본문(inquiryContent), 최근 답변(answerContent, answerRegistrationDateTime), 상품 주문(orderId, productOrderIdList, productName), 구매자(customerId, customerName) 정보가 함께 포함되어 한 번의 호출만으로 CS 화면 구성이 가능합니다. 호출 빈도가 잦은 적재 파이프라인이라면 최근 변경분만 가져오도록 일자 범위를 짧게 설정해 폴링 간격과 페이지 수를 함께 줄여야 하며, productOrderIdList 처럼 쉼표로 묶인 식별자 문자열은 호출 측에서 분해해 다른 주문 API 와 연결합니다. 400 응답은 일자 형식·범위 등 요청 파라미터 유효성 실패, 401 은 access_token 만료나 누락, 404 는 대상 자원 부재, 415/406/405 는 헤더·메서드 부적합을 의미하므로 호출 코드와 헤더 구성을 우선 점검합니다. 500 응답은 일시적인 내부 시스템 오류이므로 백오프와 함께 재시도하되, 동일 페이지를 연속 실패할 때만 운영자에게 알림을 띄워 정상 적재의 자연 복구를 방해하지 않도록 설계합니다.

> Base URL: https://api.commerce.naver.com/external

### 요청 파라미터

| 이름 | 위치 | 타입 | 필수 | 설명 |
|------|------|------|:----:|------|
| page | query |  |  | 조회할 페이지 번호. 1~1000000 사이의 값 |
| size | query |  |  | 페이지 크기. 페이지당 10~200건의 문의를 조회할 수 있습니다. |
| startSearchDate | query | string | 필수 | 문의 검색 시작일(yyyy-MM-dd). 문의 검색 시작일부터 문의 검색 종료일까지의 문의를 조회합니다. |
| endSearchDate | query | string | 필수 | 문의 검색 종료일(yyyy-MM-dd). 문의 검색 시작일부터 문의 검색 종료일까지의 문의를 조회합니다. |
| answered | query | string |  | 답변이 완료된 문의 여부(true/false). 생략 시, 답변 완료 여부에 상관없이 모든 문의를 조회합니다. |

### 응답 스키마

| 이름 | 위치 | 타입 | 필수 | 설명 |
|------|------|------|:----:|------|
| totalPages | - | integer(int32) |  |  |
| totalElements | - | integer(int64) |  |  |
| pageable | - | object |  |  |
| pageable.pageNumber | - | integer(int32) |  |  |
| pageable.pageSize | - | integer(int32) |  |  |
| pageable.sort | - | object |  |  |
| pageable.sort.… | - | - |  | 하위 구조 생략 (상세는 OAS 참조) |
| pageable.paged | - | boolean |  |  |
| pageable.unpaged | - | boolean |  |  |
| pageable.offset | - | integer(int64) |  |  |
| first | - | boolean |  |  |
| last | - | boolean |  |  |
| number | - | integer(int32) |  |  |
| sort | - | object |  |  |
| sort.sorted | - | boolean |  |  |
| sort.unsorted | - | boolean |  |  |
| sort.empty | - | boolean |  |  |
| numberOfElements | - | integer(int32) |  |  |
| size | - | integer(int32) |  |  |
| content | - | array |  |  |
| content.inquiryNo | - | integer(int64) | 필수 | 문의 번호 |
| content.category | - | string |  | 문의 유형. 상품, 배송, 반품, 교환, 환불, 기타가 존재합니다. |
| content.title | - | string | 필수 | 문의 제목 |
| content.inquiryContent | - | string | 필수 | 문의 내용 |
| content.inquiryRegistrationDateTime | - | string(date-time) | 필수 | 문의 등록 일시(yyyy-MM-dd'T'HH:mm:ss.SSSXXX) |
| content.answerContentId | - | integer(int64) |  | 최근 문의 답변 ID |
| content.answerContent | - | string |  | 최근 문의 답변 내용 |
| content.answerTemplateNo | - | integer(int64) |  | 최근 문의 답변 템플릿 번호 |
| content.answerRegistrationDateTime | - | string(date-time) |  | 최근 문의 답변 등록 일시(yyyy-MM-dd'T'HH:mm:ss.SSSXXX) |
| content.answered | - | boolean | 필수 | 문의 답변 여부 |
| content.orderId | - | string | 필수 | 주문 ID |
| content.productNo | - | string |  | 상품번호 |
| content.productOrderIdList | - | string |  | 상품 주문 ID 목록(여러 개의 상품 주문에 대해 문의했을 경우 각각의 상품 주문 ID가 ','로 구분되어 출력됨) |
| content.productName | - | string |  | 상품명 |
| content.productOrderOption | - | string |  | 상품 주문 옵션 |
| content.customerId | - | string |  | 구매자 ID |
| content.customerName | - | string | 필수 | 구매자 이름 |
| empty | - | boolean |  |  |

### 에러 코드

| 상태 코드 | 설명 |
|-----------|------|
| 500 | Internal Server Error |
| 400 | Bad Request |
| 415 | Unsupported Media Type |
| 406 | Not Acceptable |
| 405 | Method Not Allowed |
| 401 | Unauthorized |
| 404 | Not Found |

### 호출 예시

```bash
curl -X GET 'https://api.commerce.naver.com/external/v1/pay-user/inquiries?startSearchDate={startSearchDate}&endSearchDate={endSearchDate}' \
  -H 'Authorization: Bearer {access_token}'
```