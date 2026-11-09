# 쏙골라마켓 CS 자동화 허브

> 작성 중(Phase 2). 전체 README는 Phase 5에서 완성한다.

## 로컬 실행 (키 없이 mock)

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate
npm run seed
npm run dev   # http://localhost:8787
```

## ALF 태스크 API 호출 예시

모든 요청은 `X-ALF-Secret` 헤더가 필요합니다(로컬 값은 `.dev.vars`의 `dev-alf-secret`).
주문번호와 휴대폰 번호 뒤 4자리는 `npm run seed` 출력에 나오는 mock 값입니다.

```bash
# 주문 조회 — 배송 중 주문
curl -s -X POST localhost:8787/alf/orders/lookup \
  -H 'Content-Type: application/json' -H 'X-ALF-Secret: dev-alf-secret' \
  -d '{"orderNo":"2026110600000106","phoneLast4":"1206","chatId":"demo-chat-1"}'
# → {"ok":true,"decision":"INFO","reasonCode":"STATUS_SHIPPING",
#    "customerMessage":"상품이 출고되어 배송 중이에요. 배송 조회: 롯데택배 500000000006", "data":{...}}

# 취소 — 공급처 발주 후라 사람 확인
curl -s -X POST localhost:8787/alf/orders/cancel \
  -H 'Content-Type: application/json' -H 'X-ALF-Secret: dev-alf-secret' \
  -d '{"orderNo":"2026110800000103","phoneLast4":"1203"}'
# → {"ok":true,"decision":"ESCALATE","reasonCode":"SUPPLIER_ALREADY_ORDERED",
#    "customerMessage":"상품 출고 준비가 이미 시작되어 바로 처리하기 어려울 수 있어요. 담당자가 확인 후 안내드리겠습니다.", ...}

# 배송지 변경 — 발주 전이라 고객이 직접 변경하도록 안내(새 주소는 받지 않음)
curl -s -X POST localhost:8787/alf/orders/address-change \
  -H 'Content-Type: application/json' -H 'X-ALF-Secret: dev-alf-secret' \
  -d '{"orderNo":"3000000000201","phoneLast4":"2201"}'

# 반품 — 배송완료 1일, 단순 변심
curl -s -X POST localhost:8787/alf/orders/return-request \
  -H 'Content-Type: application/json' -H 'X-ALF-Secret: dev-alf-secret' \
  -d '{"orderNo":"3000000000205","phoneLast4":"2205","reason":"CHANGE_OF_MIND"}'
# → {"ok":true,"decision":"ALLOW","reasonCode":"RETURN_WITHIN_WINDOW", ...}
```

| HTTP | 의미 | ALF 태스크 처리 |
|---|---|---|
| 200 | 판단 결과(주문 없음 `ORDER_NOT_FOUND` 포함) | `decision`·`reasonCode`로 분기 |
| 400 / 401 / 5xx | 연동 문제 | Code 스텝 "요청 실패 시" 분기 → 상담원 연결 |
