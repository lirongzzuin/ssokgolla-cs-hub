import { defaultPolicyConfig, type PolicyConfig } from './policy.config';
import type { Action, Channel, OrderStatus, PolicyResult, ReturnReason } from './types';

/**
 * 상태별 허용 액션 판단 — 이 프로젝트의 핵심 로직.
 *
 * 위탁판매에서 같은 "취소해 주세요"도 답이 다른 이유는 "공급처에 발주했는가"이다.
 *   - 발주 전(PAID)            : 판매자 손에 있으므로 바로 취소 가능
 *   - 발주 후(SUPPLIER_ORDERED): 공급처가 출고를 멈춰줘야 하므로 사람이 확인
 *   - 출고 후(SHIPPED~)        : 취소가 아니라 반품으로 처리
 *
 * 순수 함수다. DB·시계·env에 의존하지 않고, 현재 시각과 설정을 인자로 받는다.
 * 상태 × 액션 표(RULES)를 먼저 보고, 표로 표현하기 어려운 반품 기간만 함수로 판단한다.
 */

export interface PolicyInput {
  channel: Channel;
  status: OrderStatus;
  needsReview: boolean;
  deliveredAt: Date | null;
}

export interface PolicyContext {
  now: Date;
  returnReason?: ReturnReason;
  config?: PolicyConfig;
}

type Rule = PolicyResult | 'RETURN_WINDOW';

const allow = (reasonCode: PolicyResult['reasonCode']): PolicyResult => ({ decision: 'ALLOW', reasonCode });
const escalate = (reasonCode: PolicyResult['reasonCode']): PolicyResult => ({ decision: 'ESCALATE', reasonCode });
const deny = (reasonCode: PolicyResult['reasonCode']): PolicyResult => ({ decision: 'DENY', reasonCode });
const info = (reasonCode: PolicyResult['reasonCode']): PolicyResult => ({ decision: 'INFO', reasonCode });

/** 클레임이 이미 진행 중이거나 끝난 주문은 어떤 변경 요청도 받지 않는다 */
const CLAIM_RULES = {
  CANCEL_REQUESTED: deny('CANCEL_IN_PROGRESS'),
  CANCELLED: deny('ALREADY_CANCELLED'),
  RETURN_REQUESTED: deny('RETURN_IN_PROGRESS'),
  RETURNED: deny('ALREADY_RETURNED'),
} as const satisfies Partial<Record<OrderStatus, Rule>>;

export const RULES: Record<Action, Record<OrderStatus, Rule>> = {
  cancel: {
    PAID: allow('CANCELABLE_BEFORE_SUPPLIER_ORDER'),
    SUPPLIER_ORDERED: escalate('SUPPLIER_ALREADY_ORDERED'),
    SHIPPED: deny('ALREADY_SHIPPED'),
    IN_TRANSIT: deny('ALREADY_SHIPPED'),
    DELIVERED: deny('ALREADY_DELIVERED'),
    ...CLAIM_RULES,
  },
  address_change: {
    PAID: allow('ADDRESS_CHANGEABLE_BEFORE_SUPPLIER_ORDER'),
    SUPPLIER_ORDERED: escalate('SUPPLIER_ALREADY_ORDERED'),
    SHIPPED: deny('ALREADY_SHIPPED'),
    IN_TRANSIT: deny('ALREADY_SHIPPED'),
    DELIVERED: deny('ALREADY_DELIVERED'),
    ...CLAIM_RULES,
  },
  return_request: {
    PAID: deny('NOT_SHIPPED_USE_CANCEL'),
    SUPPLIER_ORDERED: deny('NOT_SHIPPED_USE_CANCEL'),
    SHIPPED: deny('NOT_DELIVERED_YET'),
    IN_TRANSIT: deny('NOT_DELIVERED_YET'),
    DELIVERED: 'RETURN_WINDOW',
    ...CLAIM_RULES,
  },
  lookup: {
    PAID: info('STATUS_PREPARING'),
    SUPPLIER_ORDERED: info('STATUS_PREPARING'),
    SHIPPED: info('STATUS_SHIPPING'),
    IN_TRANSIT: info('STATUS_SHIPPING'),
    DELIVERED: info('STATUS_DELIVERED'),
    CANCEL_REQUESTED: info('STATUS_CANCEL_REQUESTED'),
    CANCELLED: info('STATUS_CANCELLED'),
    RETURN_REQUESTED: info('STATUS_RETURN_REQUESTED'),
    RETURNED: info('STATUS_RETURNED'),
  },
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 배송완료 주문의 반품 판단.
 * - 상품 하자·오배송: 기간과 관계없이 사람이 확인(사진 확인, 반품비 판매자 부담 여부 판단)
 * - 기간 경과: 거부하지 않고 사람에게 넘긴다. 하자 반품은 법정 기간이 더 길 수 있어 기계가 거절하면 안 된다.
 */
function decideReturnWindow(input: PolicyInput, ctx: PolicyContext, config: PolicyConfig): PolicyResult {
  if (ctx.returnReason === 'DEFECT' || ctx.returnReason === 'WRONG_ITEM') return escalate('RETURN_NEEDS_INSPECTION');
  if (!input.deliveredAt) return escalate('DELIVERY_DATE_UNKNOWN');
  const elapsedDays = (ctx.now.getTime() - input.deliveredAt.getTime()) / DAY_MS;
  return elapsedDays <= config.returnWindowDays[input.channel]
    ? allow('RETURN_WITHIN_WINDOW')
    : escalate('RETURN_WINDOW_EXPIRED');
}

export function decide(action: Action, input: PolicyInput, ctx: PolicyContext): PolicyResult {
  // 원천 데이터가 '확인 필요'인 주문은 상태값을 믿을 수 없으므로 조회까지 포함해 사람에게 넘긴다
  if (input.needsReview) return escalate('MANUAL_REVIEW_REQUIRED');
  const rule = RULES[action][input.status];
  if (rule === 'RETURN_WINDOW') return decideReturnWindow(input, ctx, ctx.config ?? defaultPolicyConfig);
  return rule;
}
