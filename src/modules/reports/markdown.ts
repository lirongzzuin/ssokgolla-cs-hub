import type { SummaryReport } from './service';

/** 리포트를 README·튜닝 기록에 붙여넣을 마크다운 표로 */

const REASON_LABEL: Record<string, string> = {
  SUPPLIER_ALREADY_ORDERED: '발주 후 취소·변경',
  RETURN_WINDOW_EXPIRED: '반품 기간 경과',
  RETURN_NEEDS_INSPECTION: '하자·오배송 확인',
  DELIVERY_DATE_UNKNOWN: '배송완료일 미상',
  MANUAL_REVIEW_REQUIRED: '주문 확인 필요',
  AGENT_JOINED: '상담원 직접 참여',
  COUPANG_CALLCENTER: '쿠팡 고객센터 이관',
  UNKNOWN: '미분류',
};

const TASK_LABEL: Record<string, string> = {
  order_lookup: '주문 조회',
  order_cancel: '주문 취소',
  order_address_change: '배송지 변경',
  order_return_request: '반품 접수',
};

const DECISIONS = ['ALLOW', 'ESCALATE', 'DENY', 'INFO'] as const;

const pct = (v: number | null) => (v === null ? '-' : `${v}%`);
const table = (head: string[], rows: Array<Array<string | number>>) =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join(
    '\n',
  );

export function toMarkdown(r: SummaryReport): string {
  const i = r.inquiries;
  const parts = [
    `## 운영 리포트 (${r.period.from} ~ ${r.period.to})`,
    '### 상담',
    table(
      ['전체 상담', 'ALF 단독 해결', 'ALF 해결률', '상담원 이관', '이관율'],
      [[i.total, i.resolvedByAlf, pct(i.alfResolutionRate), i.escalated, pct(i.escalationRate)]],
    ),
    '### 이관 사유',
    i.escalationReasons.length
      ? table(
          ['사유', '건수'],
          i.escalationReasons.map((x) => [REASON_LABEL[x.reason] ?? x.reason, x.count]),
        )
      : '_이관 없음_',
    '### 태스크별 판단',
    r.tasks.length
      ? table(
          ['태스크', '호출', ...DECISIONS, '평균 응답(ms)'],
          r.tasks.map((t) => [
            TASK_LABEL[t.task] ?? t.task,
            t.total,
            ...DECISIONS.map((d) => t.decisions[d] ?? 0),
            t.avgLatencyMs,
          ]),
        )
      : '_태스크 호출 없음_',
    '### 상품별 문의',
    r.products.length
      ? table(
          ['상품', '상담', '태스크 호출', '반품 접수'],
          r.products.map((p) => [p.productName, p.inquiries, p.taskCalls, p.returnRequests]),
        )
      : '_상품과 연결된 문의 없음_',
  ];
  return `${parts.join('\n\n')}\n`;
}
