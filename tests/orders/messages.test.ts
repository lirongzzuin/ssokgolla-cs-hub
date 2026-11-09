import { describe, expect, it } from 'vitest';
import { buildMockOrders } from '../../src/adapters/mock-fixtures';
import {
  ACTIONS,
  buildCustomerMessage,
  decide,
  deriveStatus,
  ESCALATE_SUFFIX,
  type OrderView,
  RETURN_REASONS,
} from '../../src/modules/orders';

const NOW = new Date('2026-11-09T12:00:00Z');

/** mock 20건을 정책·문장이 보는 형태로 바꾼다(공급처 정보 포함 — 새면 안 되는 값) */
function views(): OrderView[] {
  return buildMockOrders(NOW).map((f, i) => ({
    order: {
      id: i + 1,
      ...f.sales,
      status: deriveStatus(f.sales.status, f.supplier?.status ?? null),
    },
    supplierOrder: f.supplier,
    shipment: f.supplier?.shipment ?? null,
  }));
}

/** 모든 주문 × 모든 액션 × 모든 반품 사유의 문장 */
function allMessages() {
  return views().flatMap((view) =>
    ACTIONS.flatMap((action) =>
      RETURN_REASONS.map((returnReason) => {
        const result = decide(action, view.order, { now: NOW, returnReason });
        return { view, result, text: buildCustomerMessage(view, result) };
      }),
    ),
  );
}

describe('customerMessage 작성 규칙', () => {
  const messages = allMessages();

  it('모든 조합에서 문장이 비어 있지 않다', () => {
    expect(messages.length).toBeGreaterThan(300);
    for (const m of messages) expect(m.text.length).toBeGreaterThan(5);
  });

  it('공급처 코드·공급처 주문번호·"공급처"·매입 관련 단어를 노출하지 않는다', () => {
    for (const { view, text } of messages) {
      expect(text).not.toMatch(/공급처|도매|매입|원가|위탁|발주/);
      if (view.supplierOrder) {
        expect(text).not.toContain(view.supplierOrder.supplierCode);
        expect(text).not.toContain(view.supplierOrder.supplierOrderRef);
      }
    }
  });

  it('도착 예정일을 약속하지 않는다', () => {
    for (const { text } of messages) {
      expect(text).not.toMatch(/도착 예정|내일|모레|\d+월\s*\d+일|\d+일\s*(안에|이내|후)\s*도착/);
    }
  });

  it('ESCALATE는 "담당자가 확인 후 안내" 로 끝난다', () => {
    const escalated = messages.filter((m) => m.result.decision === 'ESCALATE');
    expect(escalated.length).toBeGreaterThan(0);
    for (const { text } of escalated) expect(text.endsWith(ESCALATE_SUFFIX)).toBe(true);
  });

  it('배송 중 안내에는 송장 정보(택배사·송장번호)를 함께 준다', () => {
    const shipping = messages.find((m) => m.result.reasonCode === 'STATUS_SHIPPING');
    expect(shipping?.view.shipment).not.toBeNull();
    expect(shipping?.text).toContain(shipping?.view.shipment?.trackingNo);
  });

  it('고객이 직접 처리하는 위치를 채널에 맞게 안내한다', () => {
    const allowCancel = messages.filter((m) => m.result.reasonCode === 'CANCELABLE_BEFORE_SUPPLIER_ORDER');
    const ss = allowCancel.find((m) => m.view.order.channel === 'smartstore');
    const cp = allowCancel.find((m) => m.view.order.channel === 'coupang');
    expect(ss?.text).toContain('네이버페이');
    expect(cp?.text).toContain('쿠팡');
  });
});
