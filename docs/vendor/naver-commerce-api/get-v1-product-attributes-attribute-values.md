# GET /v1/product-attributes/attribute-values - 카테고리별 속성값 조회

상품 속성 도메인에서 특정 카테고리에 사전 정의된 속성값 목록을 조회하는 메타정보 API 로, 카테고리별로 권장·필수로 사용되는 속성값 시퀀스와 값 범위(min/max), 단위 코드, 노출 순서를 반환한다. 상품 등록·수정 화면에서 카테고리를 선택하면 카테고리별 속성 조회로 속성 정의를 받고, 본 API 로 각 속성의 표준 값 후보를 함께 가져와 셀렉트 또는 범위 입력 UI 를 구성하는 흐름이 일반적이다. 정의된 attributeSeq 와 attributeValueSeq 조합을 그대로 상품 등록 페이로드에 사용하면 표준 속성값으로 인식되며 검색·전시 노출 품질에 유리하다. 카테고리별 속성값 정의는 변경 빈도가 낮으므로 클라이언트 캐시에 적합하며, 적절한 TTL 로 캐시해 일 단위·배포 주기로 갱신하는 정책을 권장한다. categoryId 쿼리 파라미터는 필수이며 누락·형식 오류는 400 BAD_REQUEST, 존재하지 않는 카테고리는 404 NOT_FOUND 로 응답된다. 권한 부족은 403 FORBIDDEN, 인증 오류는 401 UNAUTHORIZED 로 구분되고, 500 INTERNAL_SERVER_ERROR 는 일시 장애로 간주해 지수 백오프 기반의 제한된 재시도와 캐시 폴백을 함께 적용한다.

> Base URL: https://api.commerce.naver.com/external

### 요청 파라미터

| 이름 | 위치 | 타입 | 필수 | 설명 |
|------|------|------|:----:|------|
| categoryId | query | string | 필수 | 카테고리 ID |

### 응답 스키마

| 이름 | 위치 | 타입 | 필수 | 설명 |
|------|------|------|:----:|------|
| attributeSeq | - | integer(int64) | 필수 |  |
| attributeValueSeq | - | integer(int64) | 필수 |  |
| minAttributeValue | - | string |  |  |
| minAttributeValueUnitCode | - | string |  |  |
| maxAttributeValue | - | string |  |  |
| maxAttributeValueUnitCode | - | string |  |  |
| exposureOrder | - | integer(int32) |  |  |

### 에러 코드

| 상태 코드 | 설명 |
|-----------|------|
| 400 | 잘못된 요청<br/>- code : BAD_REQUEST |
| 401 | 인가되지 않은 요청<br/>- code : UNAUTHORIZED |
| 403 | 권한 없음<br/>- code : FORBIDDEN |
| 404 | 데이터 없음<br/>- code : NOT_FOUND |
| 500 | 내부 서버 오류<br/>- code : INTERNAL_SERVER_ERROR |

### 호출 예시

```bash
curl -X GET 'https://api.commerce.naver.com/external/v1/product-attributes/attribute-values?categoryId={categoryId}' \
  -H 'Authorization: Bearer {access_token}'
```