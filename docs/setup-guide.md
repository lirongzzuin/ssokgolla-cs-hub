# 설정 가이드 — 직접 해야 하는 일 (시간순)

코드는 모두 준비되어 있다. 아래는 사람이 계정·화면에서 직접 해야 하는 일을 순서대로 적은 것이다.
각 단계 끝의 **확인**이 통과하면 다음 단계로 넘어간다.

| 단계 | 언제 | 걸리는 시간 | 필수 |
|---|---|---|---|
| 1. 내 PC에서 돌려보기 | 지금 | 5분 | ✓ |
| 2. Cloudflare 로그인 | 지금 | 2분 | ✓ |
| 3. 인터넷에 배포(mock) | 1·2 다음 | 15분 | ✓ |
| 4. 지식 값 채우기 | 배포 후 | 15분 | ✓ |
| 5. 채널톡 설정 | 4 다음 | 1~2시간 | ✓ |
| 6. 테스트 30문항(v1 채점) | 5 다음 | 1시간 | ✓ |
| 7. 운영·튜닝(v1 → v2) | 6 다음 | 2~4주 | ✓ |
| 8. 실제 주문 연결(dropship-engine) | 원할 때 | 반나절 | 선택 |
| 9. 쿠팡 문의 브릿지 | 8 이후 | 반나절 | 선택 |
| 10. GitHub 공개 | 마지막 | 15분 | ✓ |

---

## 1. 내 PC에서 돌려보기 (5분)

키가 전혀 없어도 된다.

```bash
cd ~/ssokgolla-cs-hub
npm install
cp .dev.vars.example .dev.vars      # 이미 있으면 건너뜀
npm run db:migrate
npm run seed                        # mock 주문 20건 + 주문번호·뒤4자리 목록 출력
npm test                            # 163개 통과 확인
npm run dev                         # http://localhost:8787
```

다른 터미널에서 README "로컬 실행"의 `curl`을 실행해 본다.

**확인**: `npm test`가 모두 통과하고, `curl` 응답에 `decision`과 `customerMessage`가 있다.

## 2. Cloudflare 로그인 (2분)

1. https://dash.cloudflare.com 에서 계정을 만든다(무료 플랜으로 충분: Workers·D1·Cron).
2. 터미널에서 `npx wrangler login` → 브라우저에서 Allow.

**확인**: `npx wrangler whoami`에 내 이메일이 나온다.

## 3. 인터넷에 배포 — mock 모드 (15분)

채널톡은 내 PC에 접근할 수 없으므로 허브를 인터넷에 올린다. 처음에는 가짜 주문(mock)으로 채널톡 설정을 검증한다.

1. **실서버 DB 만들기**
   ```bash
   npx wrangler d1 create cs-hub
   ```
   출력의 `database_id` 값을 `wrangler.jsonc`의 `"database_id"`에 붙여넣는다(비밀값 아님, 커밋해도 됨).

2. **테이블 만들기 + mock 주문 넣기**
   ```bash
   npm run db:migrate:remote
   npm run seed:remote
   ```

3. **비밀값 3개 만들기**: 아래 명령을 3번 실행해 나온 값을 메모장에 `ALF_SECRET`, `ADMIN_SECRET`, `CHANNELTALK_WEBHOOK_TOKEN` 이름으로 적어 둔다. 셋은 서로 달라야 하고, `.dev.vars`의 개발용 값을 쓰면 안 된다.
   ```bash
   openssl rand -hex 32
   ```

4. **비밀값 등록**: 명령마다 값을 붙여넣으라고 나온다.
   ```bash
   npx wrangler secret put ALF_SECRET
   npx wrangler secret put ADMIN_SECRET
   npx wrangler secret put CHANNELTALK_WEBHOOK_TOKEN
   ```

5. **배포**
   ```bash
   npm run deploy
   ```
   출력의 `https://ssokgolla-cs-hub.<계정>.workers.dev`가 **허브 주소**다. 메모해 둔다.

**확인**
```bash
curl https://<허브주소>/health                     # {"ok":true,"dataSource":"mock"}
curl -s -X POST https://<허브주소>/alf/orders/lookup \
  -H 'Content-Type: application/json' -H 'X-ALF-Secret: <ALF_SECRET>' \
  -d '{"orderNo":"2026110600000106","phoneLast4":"1206"}'
```

## 4. 지식 값 채우기 (15분)

1. `docs/knowledge-source/values.json`의 빈 값을 **스마트스토어·쿠팡에 실제로 설정된 값과 같게** 채운다.
   | 키 | 예시 형식 |
   |---|---|
   | `dispatch_business_days` | `1~3영업일` |
   | `shipping_fee` | `3,000원` |
   | `free_shipping_threshold` | `30,000원` |
   | `remote_area_extra_fee` | `3,000원` |
   | `return_shipping_fee_oneway` | `3,000원` |
   | `exchange_shipping_fee_roundtrip` | `6,000원` |
   | `cs_hours` | `평일 10:00~17:00` |
2. 정책 원문(`docs/knowledge-source/*/`)을 읽고 실제 운영과 다른 문장을 고친다.
3. `npm run build-knowledge` 실행.

**확인**: 모든 줄이 `✓`이고 `dist/knowledge/`에 파일 5개가 생긴다.

## 5. 채널톡 설정 (1~2시간)

설정하면서 화면을 **캡처해 둔다**(README의 `<!-- screenshot -->` 자리에 넣는다. 고객 정보는 가린다).

1. **요금제 확인**: 지금 채널톡 요금제에서 ALF와 태스크를 쓸 수 있는지 확인한다.
2. **웹훅 등록**: 설정 > 웹훅 > 새 웹훅
   - URL: `https://<허브주소>/webhooks/channeltalk?token=<CHANNELTALK_WEBHOOK_TOKEN>`
   - 유저챗(상담) 관련 알림을 켠다.
   - **확인**: 테스트 상담에서 메시지를 보낸 뒤
     ```bash
     REPORT_BASE_URL=https://<허브주소> ADMIN_SECRET=<ADMIN_SECRET> npm run report
     ```
     전체 상담이 1 이상이면 성공. 0이면 웹훅 페이로드 필드 이름이 추측과 다른 것이다
     → `npx wrangler tail`로 실제 본문을 확인하고 `src/modules/channeltalk/webhook.parser.ts`의 `TODO(verify-api)`를 고친다.
3. **지식 업로드**: `dist/knowledge/` 5개 파일을 [01-knowledge](channeltalk/01-knowledge.md)의 폴더 구조대로 올린다.
4. **규칙 입력**: [02-rules](channeltalk/02-rules.md)의 규칙 원문 블록을 그대로 붙여넣는다.
5. **태스크 4개 만들기**: [03-tasks](channeltalk/03-tasks.md)
   - 각 태스크: AI Agent 스텝(주문번호·뒤4자리 수집) → Code 스텝(공통 틀 코드에 `<허브주소>`, `<ALF_SECRET>`, `<경로>` 입력) → 분기
   - **모든 Code 스텝에 "요청 실패 시" 분기**를 만들고 상담원에게 연결한다.
   - ⚠️ 태스크 미리보기에서는 외부 호출이 막혀 허브를 부를 수 없다. **실제 상담 창에서** 테스트한다.
   - 03-tasks의 "검증 체크리스트 — 태스크"를 하나씩 체크한다(axios 사용법, 상담 ID 경로 확인 포함).
6. **워크플로우**: [04-workflows](channeltalk/04-workflows.md)의 W1~W3을 만들고 "설정 값" 칸을 채운다.

**확인**: 실제 상담에서 "2026110800000103 / 1203 취소해 주세요" → "담당자가 확인 후 안내드리겠습니다" + `alf-이관:SUPPLIER_ALREADY_ORDERED` 태그 + 상담원 배정.

## 6. 테스트 30문항 — v1 채점 (1시간)

1. `npm run seed:remote`로 mock 주문 20건을 처음 상태로 되돌린다(반품 기간 판단이 seed 시점 기준이라서). 상담·태스크 기록은 지워지지 않는다.
2. [test-scenarios](test-scenarios.md)의 30문항을 실제 상담 창에 하나씩 입력하고 v1 칸에 ○/×를 적는다.
3. ×인 문항은 [05-tuning-log](channeltalk/05-tuning-log.md)에 실패 사례(F-001…)로 적는다.

## 7. 운영·튜닝 v1 → v2 (2~4주)

1. v1으로 1~2주 운영한다.
2. 리포트를 뽑는다.
   ```bash
   REPORT_BASE_URL=https://<허브주소> ADMIN_SECRET=<ADMIN_SECRET> npm run report -- --from 2026-11-20 --to 2026-12-03
   ```
3. 이관 사유 상위 항목과 실패 사례를 보고 지식·규칙·태스크를 고친다(고친 이유는 05-tuning-log, 문서별 변경 이력에).
4. 30문항을 다시 채점(v2 칸)하고 1~2주 더 운영한 뒤 리포트를 뽑는다.
5. README §5 표에 v1·v2 숫자를 채운다.

> mock 모드로 운영하면 실제 고객 주문은 조회되지 않는다. 실제 고객 상담으로 v1/v2를 측정하려면 8단계를 먼저 한다.

## 8. 실제 주문 연결 — dropship-engine (선택, 반나절)

허브가 가짜 주문이 아니라 위탁판매 운영 시스템(coupang-dropship-engine)의 실제 주문을 읽게 한다.
엔진은 운영 중인 시스템이라 **엔진 쪽 작업은 별도로 확인하고 진행**한다.

1. 엔진에 읽기 전용 API 추가 — 계약은 `src/adapters/engine-client.ts` 상단 주석:
   - `GET /api/cs-hub/orders?updatedSince=` (통합에 필요한 필드만, `phoneLast4`는 **주문자 실번호 기준**: 안심번호면 본인 확인이 실패한다)
   - `GET /api/cs-hub/inquiries?market=coupang&since=`, `POST /api/cs-hub/inquiries/{kind}/{id}/reply`
   - `Authorization: Bearer <ENGINE_TOKEN>` 인증
2. 엔진이 있는 Mac에 Cloudflare Tunnel(`cloudflared`)을 설치하고 **위 경로만** 외부에 연다. 고정 주소를 쓰려면 Cloudflare에 연결된 도메인이 필요하다.
3. 허브 설정 변경
   ```bash
   openssl rand -hex 32                      # ENGINE_TOKEN(엔진에도 같은 값)
   npx wrangler secret put ENGINE_TOKEN
   # wrangler.jsonc vars: "DATA_SOURCE": "live", "ENGINE_BASE_URL": "https://<터널주소>"
   npm run deploy
   ```

**확인**: 10분 뒤 Workers 로그(`npx wrangler tail`)에 `order_sync`의 `salesOrders`가 0보다 크고, 실제 주문번호로 조회 태스크가 동작한다.

## 9. 쿠팡 문의 브릿지 (선택, 8 이후)

기본 off다. [03-tasks의 "쿠팡 브릿지 검증 체크리스트"](channeltalk/03-tasks.md#검증-체크리스트--쿠팡-문의-브릿지-enable_coupang_bridge-기본-off)를 모두 확인할 수 있을 때만 켠다.
채널톡 Open API의 인증·상담 생성 방법이 확인되지 않아 `src/modules/channeltalk/client.ts`의 live 구현이 비어 있다. 확인한 내용을 알려주면 구현을 채운다.

## 10. GitHub 공개 (15분)

1. GitHub에 `ssokgolla-cs-hub` 저장소를 만든다.
2. 공개 전 점검
   - `git ls-files | grep -E "\.dev\.vars$"` → 아무것도 안 나와야 한다
   - 캡처 화면에 고객 이름·전화번호·주문번호가 보이지 않는지(모자이크)
   - 사업자등록번호·판매자 연락처·실제 주문번호·공급처 실명이 없는지
3. README의 `<!-- screenshot: ... -->` 자리에 캡처를 넣는다.
4. `git remote add origin … && git push -u origin main`
