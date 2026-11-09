import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  type Action,
  type Decision,
  decide,
  ORDER_STATUSES,
  type OrderStatus,
  type PolicyInput,
  type ReasonCode,
} from '../../src/modules/orders';

const NOW = new Date('2026-11-09T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000);

const input = (status: OrderStatus, over: Partial<PolicyInput> = {}): PolicyInput => ({
  channel: 'smartstore',
  status,
  needsReview: false,
  deliveredAt: status === 'DELIVERED' ? daysAgo(1) : null,
  ...over,
});

/**
 * 정책 표 전체. docs/architecture.md §5.2 표와 1:1로 대응한다.
 * 표가 바뀌면 이 테스트와 문서를 같이 고친다.
 */
const EXPECTED: Record<Action, Record<OrderStatus, [Decision, ReasonCode]>> = {
  cancel: {
    PAID: ['ALLOW', 'CANCELABLE_BEFORE_SUPPLIER_ORDER'],
    SUPPLIER_ORDERED: ['ESCALATE', 'SUPPLIER_ALREADY_ORDERED'],
    SHIPPED: ['DENY', 'ALREADY_SHIPPED'],
    IN_TRANSIT: ['DENY', 'ALREADY_SHIPPED'],
    DELIVERED: ['DENY', 'ALREADY_DELIVERED'],
    CANCEL_REQUESTED: ['DENY', 'CANCEL_IN_PROGRESS'],
    CANCELLED: ['DENY', 'ALREADY_CANCELLED'],
    RETURN_REQUESTED: ['DENY', 'RETURN_IN_PROGRESS'],
    RETURNED: ['DENY', 'ALREADY_RETURNED'],
  },
  address_change: {
    PAID: ['ALLOW', 'ADDRESS_CHANGEABLE_BEFORE_SUPPLIER_ORDER'],
    SUPPLIER_ORDERED: ['ESCALATE', 'SUPPLIER_ALREADY_ORDERED'],
    SHIPPED: ['DENY', 'ALREADY_SHIPPED'],
    IN_TRANSIT: ['DENY', 'ALREADY_SHIPPED'],
    DELIVERED: ['DENY', 'ALREADY_DELIVERED'],
    CANCEL_REQUESTED: ['DENY', 'CANCEL_IN_PROGRESS'],
    CANCELLED: ['DENY', 'ALREADY_CANCELLED'],
    RETURN_REQUESTED: ['DENY', 'RETURN_IN_PROGRESS'],
    RETURNED: ['DENY', 'ALREADY_RETURNED'],
  },
  return_request: {
    PAID: ['DENY', 'NOT_SHIPPED_USE_CANCEL'],
    SUPPLIER_ORDERED: ['DENY', 'NOT_SHIPPED_USE_CANCEL'],
    SHIPPED: ['DENY', 'NOT_DELIVERED_YET'],
    IN_TRANSIT: ['DENY', 'NOT_DELIVERED_YET'],
    DELIVERED: ['ALLOW', 'RETURN_WITHIN_WINDOW'],
    CANCEL_REQUESTED: ['DENY', 'CANCEL_IN_PROGRESS'],
    CANCELLED: ['DENY', 'ALREADY_CANCELLED'],
    RETURN_REQUESTED: ['DENY', 'RETURN_IN_PROGRESS'],
    RETURNED: ['DENY', 'ALREADY_RETURNED'],
  },
  lookup: {
    PAID: ['INFO', 'STATUS_PREPARING'],
    SUPPLIER_ORDERED: ['INFO', 'STATUS_PREPARING'],
    SHIPPED: ['INFO', 'STATUS_SHIPPING'],
    IN_TRANSIT: ['INFO', 'STATUS_SHIPPING'],
    DELIVERED: ['INFO', 'STATUS_DELIVERED'],
    CANCEL_REQUESTED: ['INFO', 'STATUS_CANCEL_REQUESTED'],
    CANCELLED: ['INFO', 'STATUS_CANCELLED'],
    RETURN_REQUESTED: ['INFO', 'STATUS_RETURN_REQUESTED'],
    RETURNED: ['INFO', 'STATUS_RETURNED'],
  },
};

describe('policy.decide — 상태 × 액션 전체 표', () => {
  for (const action of ACTIONS) {
    for (const status of ORDER_STATUSES) {
      const [decision, reasonCode] = EXPECTED[action][status];
      it(`${action} @ ${status} → ${decision} ${reasonCode}`, () => {
        expect(decide(action, input(status), { now: NOW })).toEqual({ decision, reasonCode });
      });
    }
  }
});

describe('policy.decide — 위탁판매 핵심: 공급처 발주 전/후', () => {
  it('같은 취소 요청이라도 발주 전이면 허용, 발주 후면 사람 확인', () => {
    expect(decide('cancel', input('PAID'), { now: NOW }).decision).toBe('ALLOW');
    expect(decide('cancel', input('SUPPLIER_ORDERED'), { now: NOW }).decision).toBe('ESCALATE');
  });

  it('출고 전 반품 요청은 취소로 안내한다', () => {
    expect(decide('return_request', input('SUPPLIER_ORDERED'), { now: NOW }).reasonCode).toBe('NOT_SHIPPED_USE_CANCEL');
  });
});

describe('policy.decide — 반품 기간', () => {
  it('배송완료 7일째(경계)는 허용', () => {
    const r = decide('return_request', input('DELIVERED', { deliveredAt: daysAgo(7) }), { now: NOW });
    expect(r).toEqual({ decision: 'ALLOW', reasonCode: 'RETURN_WITHIN_WINDOW' });
  });

  it('7일을 1분이라도 넘기면 거부가 아니라 사람 확인', () => {
    const deliveredAt = new Date(daysAgo(7).getTime() - 60_000);
    const r = decide('return_request', input('DELIVERED', { deliveredAt }), { now: NOW });
    expect(r).toEqual({ decision: 'ESCALATE', reasonCode: 'RETURN_WINDOW_EXPIRED' });
  });

  it('배송완료 일자를 모르면 사람 확인', () => {
    const r = decide('return_request', input('DELIVERED', { deliveredAt: null }), { now: NOW });
    expect(r.reasonCode).toBe('DELIVERY_DATE_UNKNOWN');
  });

  it.each(['DEFECT', 'WRONG_ITEM'] as const)('하자·오배송(%s)은 기간 안이어도 사람 확인', (returnReason) => {
    const r = decide('return_request', input('DELIVERED', { deliveredAt: daysAgo(1) }), { now: NOW, returnReason });
    expect(r).toEqual({ decision: 'ESCALATE', reasonCode: 'RETURN_NEEDS_INSPECTION' });
  });

  it('단순 변심은 기간으로만 판단', () => {
    const r = decide('return_request', input('DELIVERED'), { now: NOW, returnReason: 'CHANGE_OF_MIND' });
    expect(r.decision).toBe('ALLOW');
  });

  it('채널별 기간 설정을 따른다(policy.config 교체)', () => {
    const config = { returnWindowDays: { smartstore: 7, coupang: 30 } };
    const order = input('DELIVERED', { channel: 'coupang', deliveredAt: daysAgo(20) });
    expect(decide('return_request', order, { now: NOW, config }).decision).toBe('ALLOW');
    expect(decide('return_request', { ...order, channel: 'smartstore' }, { now: NOW, config }).decision).toBe(
      'ESCALATE',
    );
  });
});

describe('policy.decide — 확인 필요 주문', () => {
  it.each(ACTIONS)('needsReview면 %s 도 사람 확인', (action) => {
    const r = decide(action, input('PAID', { needsReview: true }), { now: NOW });
    expect(r).toEqual({ decision: 'ESCALATE', reasonCode: 'MANUAL_REVIEW_REQUIRED' });
  });
});

describe('policy.decide — 순수 함수', () => {
  it('같은 입력이면 같은 결과, 입력을 바꾸지 않는다', () => {
    const order = Object.freeze(input('DELIVERED'));
    const a = decide('return_request', order, { now: NOW });
    const b = decide('return_request', order, { now: NOW });
    expect(a).toEqual(b);
  });
});
