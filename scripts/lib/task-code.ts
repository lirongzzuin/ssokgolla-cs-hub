/**
 * 채널톡 ALF 태스크 Code 스텝에 붙여넣을 코드 생성. 파일 입출력 없는 순수 함수(테스트: tests/scripts/task-code.test.ts).
 *
 * 왜 생성하나: 로컬 + 임시 터널로 연동하면 허브 주소가 터널을 켤 때마다 바뀐다.
 * 5개 태스크 코드에 주소·시크릿을 손으로 고치다 틀리는 일을 없애려고 한 번에 다시 만든다.
 *
 * 채널톡 Code 스텝 사실(공식 문서, 확인 2026-11-09): handler(memory, context, isSandbox) 형식, axios로 HTTP 호출,
 * memory.get/put/save, 미리보기(isSandbox)에서는 외부 요청 차단, 최대 60초.
 * 확인 필요: axios를 꺼내는 방법(전역 가정), 상담 ID 경로(context.userChat.id 가정) → ping 태스크로 확인한다.
 */

export interface TaskDef {
  file: string;
  title: string;
  path: string;
  /** 반품 태스크만: memory.returnReason 을 보낸다 */
  withReason?: boolean;
  ping?: boolean;
}

export const TASKS: TaskDef[] = [
  { file: '00-ping.js', title: '연결 확인', path: 'ping', ping: true },
  { file: '01-order-lookup.js', title: '주문 조회', path: 'orders/lookup' },
  { file: '02-order-cancel.js', title: '주문 취소', path: 'orders/cancel' },
  { file: '03-address-change.js', title: '배송지 변경', path: 'orders/address-change' },
  { file: '04-return-request.js', title: '반품 접수', path: 'orders/return-request', withReason: true },
];

export function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^/\s]+$/.test(trimmed)) {
    throw new Error(`허브 주소는 https://호스트 형식이어야 합니다(경로 없이): ${url}`);
  }
  return trimmed;
}

export function renderTaskCode(task: TaskDef, baseUrl: string, secret: string): string {
  const url = `${normalizeBaseUrl(baseUrl)}/alf/${task.path}`;
  const body = task.ping
    ? `  const body = { chatId: context.userChat?.id };`
    : [
        `  const body = {`,
        `    orderNo: String(memory.get('orderNo') ?? ''),`,
        `    phoneLast4: String(memory.get('phoneLast4') ?? ''),`,
        ...(task.withReason
          ? [
              `    // CHANGE_OF_MIND | DEFECT | WRONG_ITEM | OTHER (AI Agent 스텝이 분류해 저장)`,
              `    reason: String(memory.get('returnReason') ?? 'OTHER'),`,
            ]
          : []),
        `    chatId: context.userChat?.id,`,
        `  };`,
      ].join('\n');

  return `// 쏙골라마켓 CS 허브 — ${task.title} (${task.path})
// 생성: npm run task-code. 허브 주소가 바뀌면 다시 생성해 붙여넣는다.
// 확인 필요 ①: axios를 전역으로 쓸 수 있는지(안 되면 채널톡 문서의 허용 방식으로 가져온다)
// 확인 필요 ②: context.userChat?.id 가 상담 ID인지(00-ping 결과 메시지로 확인)
export const handler = async (memory, context, isSandbox) => {
  if (isSandbox) {
    // 태스크 미리보기에서는 외부 요청이 막혀 있어 분기만 확인한다
    memory.put('hubDecision', 'INFO');
    memory.put('hubReasonCode', 'SANDBOX');
    memory.put('hubMessage', '(미리보기) 실제 상담에서 허브를 호출합니다.');
    memory.save();
    return;
  }

${body}

  // 400/401/5xx는 axios가 예외를 던진다 → Code 스텝의 "요청 실패 시" 분기로 간다
  const res = await axios.post('${url}', body, {
    headers: { 'X-ALF-Secret': '${secret}' },
    timeout: 10000,
  });

  memory.put('hubOk', res.data.ok);
  memory.put('hubDecision', res.data.decision);
  memory.put('hubReasonCode', res.data.reasonCode);
  memory.put('hubMessage', res.data.customerMessage);
  memory.put('hubStatusLabel', res.data.data?.order?.statusLabel ?? '');
  memory.save();
};
`;
}

export function webhookUrl(baseUrl: string, token: string): string {
  return `${normalizeBaseUrl(baseUrl)}/webhooks/channeltalk?token=${encodeURIComponent(token)}`;
}
