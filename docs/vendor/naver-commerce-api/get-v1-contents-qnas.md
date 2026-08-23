# GET /v1/contents/qnas - 상품 문의 목록 조회

스마트스토어에 등록된 상품 문의(QnA)를 기간 기준으로 페이지 단위 조회하여 미답변 건을 식별하거나 응답 SLA 추적용 데이터를 적재할 때 사용하는 API입니다. fromDate와 toDate는 필수 쿼리 파라미터로 검색 시작·종료 일시를 ISO 8601 date-time 형식으로 지정하며, answered 파라미터를 false로 주면 미답변 건만 골라낼 수 있고 page·size로 페이지 번호와 페이지당 최대 100건 범위 내에서 결과 조각을 조정합니다. CS 자동화 파이프라인에서는 일정 폴링 주기(보통 5~10분)로 본 API를 호출해 신규 미답변 건을 큐에 적재한 뒤 답변 등록 API로 흘려보내는 구조가 일반적이며, 누락을 막기 위해 직전 호출의 toDate를 다음 호출의 fromDate로 약간 겹쳐 호출하는 워크플로우가 안전합니다. 응답의 maskedWriterId처럼 마스킹된 식별자는 원본 작성자 정보 노출 없이 답변 분류에만 활용해야 하며, totalElements와 totalPages로 전체 적재량을 산정해 페이지 끝까지 순회하는 종료 조건을 명확히 두어 무한 루프를 방지해야 합니다. 날짜 형식·기간 길이 검증 실패 시 400 BAD_REQUEST, 토큰 만료·누락 시 401 UNAUTHORIZED, 해당 채널 조회 권한이 없으면 403 FORBIDDEN이 떨어지며 일시적인 500 INTERNAL_SERVER_ERROR는 지수 백오프와 재시도로 대응합니다. 404 NOT_FOUND가 반환되는 경우에는 채널 매핑이나 입력 파라미터를 재점검한 후 운영 시스템 알림과 함께 처리합니다.

> Base URL: https://api.commerce.naver.com/external

### 요청 파라미터

| 이름 | 위치 | 타입 | 필수 | 설명 |
|------|------|------|:----:|------|
| page | query | integer(int32) |  | 페이지 번호. 첫 번째 페이지 번호는 1입니다. |
| size | query | integer(int32) |  | 페이지 크기. 페이지당 최대 100건까지 조회할 수 있습니다. |
| answered | query | boolean |  | 답변 여부 |
| fromDate | query | string(date-time) | 필수 | 검색 시작 일시 |
| toDate | query | string(date-time) | 필수 | 검색 종료 일시 |

### 응답 스키마

| 이름 | 위치 | 타입 | 필수 | 설명 |
|------|------|------|:----:|------|
| contents | - | array |  |  |
| contents.createDate | - | string(date-time) |  |  |
| contents.question | - | string |  |  |
| contents.answer | - | string |  |  |
| contents.answered | - | boolean |  |  |
| contents.productId | - | integer(int64) |  |  |
| contents.productName | - | string |  |  |
| contents.maskedWriterId | - | string |  |  |
| contents.questionId | - | integer(int64) |  |  |
| page | - | integer(int32) |  |  |
| size | - | integer(int32) |  |  |
| totalElements | - | integer(int64) |  |  |
| totalPages | - | integer(int32) |  |  |
| sort | - | object |  |  |
| sort.sorted | - | boolean |  |  |
| sort.fields | - | array |  |  |
| sort.fields.… | - | - |  | 하위 구조 생략 (상세는 OAS 참조) |
| first | - | boolean |  |  |
| last | - | boolean |  |  |

### 에러 코드

| 상태 코드 | 설명 |
|-----------|------|
| 400 | 잘못된 요청<br>- code : BAD_REQUEST |
| 401 | 인가되지 않은 요청<br>- code : UNAUTHORIZED |
| 403 | 권한 없음<br>- code : FORBIDDEN |
| 404 | 데이터 없음<br>- code : NOT_FOUND |
| 500 | 내부 서버 오류<br>- code : INTERNAL_SERVER_ERROR |

### 사용 enum 카탈로그

- 응답 `sort.fields[].direction`: `asc`, `desc`

### 호출 예시

```bash
curl -X GET 'https://api.commerce.naver.com/external/v1/contents/qnas?fromDate={fromDate}&toDate={toDate}' \
  -H 'Authorization: Bearer {access_token}'
```