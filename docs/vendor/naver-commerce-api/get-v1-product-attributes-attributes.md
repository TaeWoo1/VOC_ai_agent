# GET /v1/product-attributes/attributes - 카테고리별 속성 조회

상품 속성 도메인에서 특정 카테고리에 정의된 속성(필드) 메타 정의를 조회하는 API 로, 속성명·분류 유형(SINGLE_SELECT, MULTI_SELECT, RANGE)·속성 유형(PRIMARY, OPTIONAL)·단위 사용 여부·대표 단위 코드·다중 매칭 허용 개수를 함께 반환한다. 상품 등록·수정 흐름에서 카테고리를 선택한 직후 본 API 를 호출해 어떤 속성 필드가 단일 선택인지 다중 선택인지 범위 입력인지, 필수(PRIMARY)인지 선택(OPTIONAL)인지 동적으로 결정하고, 카테고리별 속성값 조회로 후보값을 채워 폼을 구성하는 형태가 일반적이다. attributeValueMaxMatchingCount 는 다중 선택 속성에서 한 번에 선택할 수 있는 값의 상한을 나타내므로 클라이언트 검증 로직에 그대로 활용한다. 카테고리별 속성 정의는 변경 빈도가 낮아 클라이언트에서 적절한 TTL 로 캐시해 두는 운영이 권장된다. categoryId 쿼리 파라미터는 필수이며, 누락·형식 오류는 400 BAD_REQUEST, 존재하지 않는 카테고리는 404 NOT_FOUND 로 응답된다. 권한 부족은 403 FORBIDDEN, 인증 오류는 401 UNAUTHORIZED, 일시 장애는 500 INTERNAL_SERVER_ERROR 로 분리되며 후자에 대해서는 지수 백오프 기반 재시도와 캐시 폴백을 적용한다.

> Base URL: https://api.commerce.naver.com/external

### 요청 파라미터

| 이름 | 위치 | 타입 | 필수 | 설명 |
|------|------|------|:----:|------|
| categoryId | query | string | 필수 | 카테고리 ID |

### 응답 스키마

| 이름 | 위치 | 타입 | 필수 | 설명 |
|------|------|------|:----:|------|
| attributeSeq | - | integer(int64) | 필수 |  |
| attributeName | - | string |  |  |
| attributeClassificationType | - | string |  | 허용값: `SINGLE_SELECT`, `MULTI_SELECT`, `RANGE` |
| attributeClassificationCodeName | - | string |  |  |
| attributeType | - | string |  | 허용값: `PRIMARY`, `OPTIONAL` |
| attributeTypeCodeName | - | string |  |  |
| unitUsable | - | boolean |  |  |
| representativeUnitCode | - | string |  |  |
| attributeValueMaxMatchingCount | - | integer(int32) |  |  |

### 에러 코드

| 상태 코드 | 설명 |
|-----------|------|
| 400 | 잘못된 요청<br/>- code : BAD_REQUEST |
| 401 | 인가되지 않은 요청<br/>- code : UNAUTHORIZED |
| 403 | 권한 없음<br/>- code : FORBIDDEN |
| 404 | 데이터 없음<br/>- code : NOT_FOUND |
| 500 | 내부 서버 오류<br/>- code : INTERNAL_SERVER_ERROR |

### 사용 enum 카탈로그

- 응답 `[].attributeClassificationType`: `SINGLE_SELECT`, `MULTI_SELECT`, `RANGE`
- 응답 `[].attributeType`: `PRIMARY`, `OPTIONAL`

### 호출 예시

```bash
curl -X GET 'https://api.commerce.naver.com/external/v1/product-attributes/attributes?categoryId={categoryId}' \
  -H 'Authorization: Bearer {access_token}'
```