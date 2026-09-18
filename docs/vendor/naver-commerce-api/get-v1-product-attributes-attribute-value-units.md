# GET /v1/product-attributes/attribute-value-units - 전체 속성값 단위 조회

상품 속성 도메인에서 속성값에 사용되는 단위 코드 전체 목록을 조회하는 메타정보 API 로, kg/cm/ml/inch 같은 측정 단위 코드와 표시명을 한 번에 받아 단위 선택 UI 를 구성하거나 속성값 등록 시 단위 코드 검증에 활용한다. 일반적으로는 카테고리별 속성 조회 결과의 representativeUnitCode 와 본 API 의 unitCodeName 을 매핑해 사용자에게는 가독성 있는 표시명을 노출하고 서버에는 코드값을 보내는 형태로 사용한다. 단위 정의는 시스템 전역에서 공유되고 변경 빈도가 매우 낮으므로 클라이언트 캐시에 적합하며, 일 단위·배포 주기로 갱신하는 정책이 권장된다. 요청 파라미터가 없어 호출 자체는 단순하지만 응답이 정적이라는 점을 감안해 클라이언트 측 캐시 정책을 적극 적용하는 편이 효율적이다. 권한 부족은 403 FORBIDDEN, 인증 오류는 401 UNAUTHORIZED, 형식 오류는 400 BAD_REQUEST, 데이터 부재는 404 NOT_FOUND 로 응답되고, 500 INTERNAL_SERVER_ERROR 는 일시 장애로 보아 지수 백오프 기반의 제한된 재시도와 이전 캐시로의 폴백을 함께 두는 것이 안정적이다.

> Base URL: https://api.commerce.naver.com/external

### 응답 스키마

| 이름 | 위치 | 타입 | 필수 | 설명 |
|------|------|------|:----:|------|
| id | - | string | 필수 |  |
| unitCodeName | - | string | 필수 |  |

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
curl -X GET 'https://api.commerce.naver.com/external/v1/product-attributes/attribute-value-units' \
  -H 'Authorization: Bearer {access_token}'
```