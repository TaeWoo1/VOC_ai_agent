# 인증

커머스API는 OAuth2 규약에 따라 요청에 대한 인증을 수행합니다.

개발사에 제공하는 API는 서버 간(개발사 서버 - 커머스플랫폼 서버) 연동을 위한 API입니다. 따라서 OAuth2의 [Client Credentials Grant](https://tools.ietf.org/html/rfc6749#section-4.4) 방식의 인증 규격을 사용합니다.

## Authentication

**OAuth 2.0: Client-Credentials**

인증 토큰 발급 후 API 요청 시 Authorization 헤더를 추가합니다.

> Authorization: Bearer {인증 토큰}

| 항목 | 값 |
|---|---|
| Security Scheme Type | oauth2 |
| OAuth Flow (clientCredentials) | Token URL: https://api.commerce.naver.com/external/v1/oauth2/token |

Scopes:

- N/A: 커머스API는 'scopes' 스펙을 제공하지 않습니다.

## 인증 토큰 발급

[인증 토큰 발급 요청 API](/commerce-api/current/exchange-sellers-auth)를 참고합니다.

### API 인증 실패 후 재시도

API 요청 및 응답을 정상적으로 수신하는 중 아래와 같이 API 응답에 401 HTTP 상태 코드와 함께 게이트웨이 서버 오류 코드 `GW.AUTHN`이 포함되어 있다면 인증 토큰이 만료되었을 가능성이 높습니다.

```json
HTTP/1.1 401 Unauthorized
date: Tue, 05 Nov 2023 14:35:24 GMT
content-type: application/json
content-length: 168
gncp-gw-trace-id: cr3-000000-aaaaaa^1730711073284^6745261

{
    "code":"GW.AUTHN",
    "message":"요청을 보낼 권한이 없습니다.",
    "timestamp":"2023-11-05T23:35:24.415+09:00",
    "traceId":"cr3-000000-aaaaaa^1730711073284^6745261"
}
```

따라서 API 클라이언트 프로그램 개발 시 API 인증 실패 응답에 대해 다음과 같이 [인증 토큰 발급 요청 API](/commerce-api/current/exchange-sellers-auth)를 재호출하여 인증 토큰을 재발급받는 fallback 처리를 권장합니다.

```bash
/* fallback pseudocode */
retry {
    response = API_호출(with access_token)
} when {
    response.status == 401 && response.body.code == 'GW.AUTHN'
} before {
    access_token = 인증_토큰_발급_요청(client_id, client_secret_sign, timestamp, 'client_credentials', 'SELF')
}
```

## 전자서명

커머스API는 개발사의 인증 토큰 발급 요청 시 직접 클라이언트 시크릿 값을 전달하지 않고 전자서명(signature)을 생성 후 전달하는 방법으로 클라이언트 시크릿 탈취에 대해 강화된 보안을 제공합니다.

전자서명 생성 시에는 개발사에 미리 제공한 다음의 정보를 사용해야 합니다.

- `client_id`: 애플리케이션 ID
- `client_secret`: 애플리케이션 시크릿
- `timestamp`: 밀리초(millisecond) 단위의 Unix 시간

### 전자서명 생성 방법

#### 1. bcrypt 해싱

전자서명은 [bcrypt](https://ko.wikipedia.org/wiki/Bcrypt) 해싱을 사용하여 생성합니다. 생성에 사용되는 bcrypt 해싱 함수 실행에는 2개의 파라미터가 필요합니다.

```
BCrypt.hashpw(password, salt)
```

- `password`: 제공된 `client_id`와 `timestamp` 값을 밑줄(`_`)로 연결합니다.
- 예: `client_id`가 'aaaabbbb', `timestamp`가 '1643956077762'인 경우 `aaaabbbb_1643956077762`
- `salt`: 제공된 `client_secret`을 사용합니다.

#### 2. 인코딩

생성된 전자서명을 HTTP Query 파라미터로 전달하기 위해 Base64 인코딩을 수행합니다.

### 코드 예시

다음은 전자서명을 생성하기 위한 간단한 언어별 코드 예시입니다.

#### Java

- 사용 라이브러리: JBCrypt
- 다운로드 주소: [https://github.com/jeremyh/jBCrypt](https://github.com/jeremyh/jBCrypt)

```java
class SignatureGenerator {
    public static String generateSignature(String clientId, String clientSecret, Long timestamp) {
        // 밑줄로 연결하여 password 생성
        String password = StringUtils.joinWith("_", clientId, timestamp);
        // bcrypt 해싱
        String hashedPw = BCrypt.hashpw(password, clientSecret);
        // base64 인코딩
        return Base64.getUrlEncoder().encodeToString(hashedPw.getBytes(StandardCharsets.UTF_8));
    }

    public static void main(String args[]) {
        String clientId = "aaaabbbbcccc";
        String clientSecret = "$2a$10$abcdefghijklmnopqrstuv";
        Long timestamp = System.currentTimeMillis(); // 1643961623299L로 가정
        System.out.println(generateSignature(clientId, clientSecret, timestamp));
    }
}

// 실행 결과
JDJhJDEwJGFiY2RlZmdoaWprbG1ub3BxcnN0dXVCVldZSk42T0VPdEx1OFY0cDQxa2IuTnpVaUEzbmsy
```

#### Python

- 사용 라이브러리: bcrypt, pybase64
- 설치 명령어: `pip install bcrypt`, `pip install pybase64`

```python
#!/usr/bin/env python

import bcrypt
import pybase64

clientId = "aaaabbbbcccc"
clientSecret = "$2a$10$abcdefghijklmnopqrstuv"
timestamp = 1643961623299
# 밑줄로 연결하여 password 생성
password = clientId + "_" + str(timestamp)
# bcrypt 해싱
hashed = bcrypt.hashpw(password.encode('utf-8'), clientSecret.encode('utf-8'))
# base64 인코딩
print(pybase64.standard_b64encode(hashed).decode('utf-8'))

# 실행 결과
JDJhJDEwJGFiY2RlZmdoaWprbG1ub3BxcnN0dXVCVldZSk42T0VPdEx1OFY0cDQxa2IuTnpVaUEzbmsy
```

#### Node.js

- 사용 라이브러리: bcrypt
- 설치 명령어: `npm install bcrypt`

```javascript
const bcrypt = require("bcrypt");

const clientId = "aaaabbbbcccc";
const clientSecret = "$2a$10$abcdefghijklmnopqrstuv";
const timestamp = 1643961623299;
// 밑줄로 연결하여 password 생성
const password = `${clientId}_${timestamp}`;
// bcrypt 해싱
const hashed = bcrypt.hashSync(password, clientSecret);
// base64 인코딩
console.log(Buffer.from(hashed, "utf-8").toString("base64"));

// 실행 결과
JDJhJDEwJGFiY2RlZmdoaWprbG1ub3BxcnN0dXVCVldZSk42T0VPdEx1OFY0cDQxa2IuTnpVaUEzbmsy
```

#### PHP

```php
<?php
$client_id = 'aaaabbbbcccc';
$client_secret = '$2a$10$abcdefghijklmnopqrstuv';
$timestamp = (int)(microtime(true) * 1000);
// 밑줄로 연결하여 password 생성
$password = $client_id.'_'.$timestamp;
// bcrypt 해싱
$hashed = crypt($password, $client_secret);
// base64 인코딩
print(base64_encode($hashed));

// 실행 결과
JDJhJDA0JFE4U1AuaS9FVG11ZzN0cWlXRUpYaU9ia0lORjZ4cGw1NWJxVWRYdVdjLmJYbU82RUpHZWF1
```
