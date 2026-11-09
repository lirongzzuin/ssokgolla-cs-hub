import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { taskResponseSchema } from '../../src/modules/alf-tasks';
import { fixture, resetAndSeed } from '../helpers';

type Fixtures = Awaited<ReturnType<typeof resetAndSeed>>;
let fx: Fixtures;

beforeEach(async () => {
  fx = await resetAndSeed();
});

function call(path: string, body: unknown, secret: string | null = env.ALF_SECRET ?? '') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret !== null) headers['X-ALF-Secret'] = secret;
  return app.request(`/alf/orders/${path}`, { method: 'POST', headers, body: JSON.stringify(body) }, env);
}

async function callOk(path: string, body: unknown) {
  const res = await call(path, body);
  expect(res.status).toBe(200);
  // 응답 계약 검증: 채널톡 태스크 코드가 기대하는 모양 그대로인지
  return taskResponseSchema.parse(await res.json());
}

const req = (scenario: string, extra: Record<string, unknown> = {}) => {
  const { sales } = fixture(fx, scenario);
  return { orderNo: sales.channelOrderId, phoneLast4: sales.phoneLast4, ...extra };
};

describe('인증', () => {
  it('X-ALF-Secret이 없으면 401', async () => {
    const res = await call('lookup', req('smartstore · 결제 직후(발주 전)'), null);
    expect(res.status).toBe(401);
  });

  it('틀린 시크릿이면 401', async () => {
    const res = await call('lookup', req('smartstore · 결제 직후(발주 전)'), 'wrong');
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, reasonCode: 'UNAUTHORIZED' });
  });
});

describe('입력 검증', () => {
  it('뒤 4자리가 아니면 400', async () => {
    const res = await call('lookup', { orderNo: '2026110900000101', phoneLast4: '123' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, reasonCode: 'INVALID_REQUEST' });
  });

  it('주문번호만으로는 조회할 수 없다(D3)', async () => {
    expect((await call('lookup', { orderNo: '2026110900000101' })).status).toBe(400);
  });

  it('배송지 변경은 새 주소를 받지 않는다(모르는 필드 거부)', async () => {
    const res = await call(
      'address-change',
      req('smartstore · 결제 직후(발주 전)', { newAddress: '서울특별시 강남구 테헤란로 1' }),
    );
    expect(res.status).toBe(400);
  });

  it('ALF가 옮긴 하이픈·공백은 정리한다', async () => {
    const r = await callOk('lookup', { orderNo: '2026-1109-0000-0101', phoneLast4: ' 1201 ' });
    expect(r.ok).toBe(true);
  });

  it('JSON이 아니면 400', async () => {
    const res = await app.request(
      '/alf/orders/lookup',
      { method: 'POST', headers: { 'X-ALF-Secret': env.ALF_SECRET ?? '' }, body: 'not json' },
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /alf/orders/lookup', () => {
  it('없는 주문과 틀린 뒤 4자리는 같은 응답(200, ORDER_NOT_FOUND)', async () => {
    const wrongLast4 = await callOk('lookup', { orderNo: '2026110900000101', phoneLast4: '9999' });
    const noOrder = await callOk('lookup', { orderNo: '1111111111111111', phoneLast4: '1201' });
    expect(wrongLast4).toEqual(noOrder);
    expect(noOrder).toMatchObject({ ok: false, decision: 'DENY', reasonCode: 'ORDER_NOT_FOUND', data: null });
  });

  it('배송 중이면 송장 정보를 주고, 공급처 정보는 응답 어디에도 없다', async () => {
    const res = await call('lookup', req('smartstore · 배송 중'));
    const raw = await res.text();
    const body = taskResponseSchema.parse(JSON.parse(raw));
    expect(body).toMatchObject({ decision: 'INFO', reasonCode: 'STATUS_SHIPPING' });
    expect(body.data?.order.shipment?.carrier).toBe('롯데택배');
    expect(raw).not.toMatch(/SUPPLIER_|MOCK-PO|supplier/i);
  });

  it('발주 후 주문도 고객에게는 "상품 준비 중"으로만 보인다', async () => {
    const r = await callOk('lookup', req('coupang · 발주 완료(출고 전)'));
    expect(r.data?.order.statusLabel).toBe('상품 준비 중');
  });

  it('확인 필요 주문은 조회도 사람에게', async () => {
    const r = await callOk('lookup', req('smartstore · 확인 필요(원천 예외)'));
    expect(r).toMatchObject({ decision: 'ESCALATE', reasonCode: 'MANUAL_REVIEW_REQUIRED' });
  });
});

describe('POST /alf/orders/cancel', () => {
  it('발주 전이면 ALLOW → 허브에 취소 요청 표시 → 다시 요청하면 처리 중', async () => {
    const first = await callOk('cancel', req('smartstore · 결제 직후(발주 전)'));
    expect(first).toMatchObject({ decision: 'ALLOW', reasonCode: 'CANCELABLE_BEFORE_SUPPLIER_ORDER' });
    expect(first.data?.order.status).toBe('CANCEL_REQUESTED');

    const again = await callOk('cancel', req('smartstore · 결제 직후(발주 전)'));
    expect(again).toMatchObject({ decision: 'DENY', reasonCode: 'CANCEL_IN_PROGRESS' });
  });

  it('발주 후면 ESCALATE, 상태는 바꾸지 않는다', async () => {
    const r = await callOk('cancel', req('smartstore · 발주 완료(출고 전)'));
    expect(r).toMatchObject({ decision: 'ESCALATE', reasonCode: 'SUPPLIER_ALREADY_ORDERED' });
    expect(r.customerMessage).toContain('담당자가 확인 후 안내드리겠습니다');
    expect(r.data?.order.status).toBe('SUPPLIER_ORDERED');
  });

  it('출고 후면 DENY + 반품 안내', async () => {
    const r = await callOk('cancel', req('coupang · 출고 완료'));
    expect(r).toMatchObject({ decision: 'DENY', reasonCode: 'ALREADY_SHIPPED' });
    expect(r.customerMessage).toContain('반품');
  });
});

describe('POST /alf/orders/address-change', () => {
  it('발주 전이면 고객이 직접 변경하도록 안내(상태 변화 없음)', async () => {
    const r = await callOk('address-change', req('coupang · 결제 직후(발주 전)'));
    expect(r).toMatchObject({ decision: 'ALLOW', reasonCode: 'ADDRESS_CHANGEABLE_BEFORE_SUPPLIER_ORDER' });
    expect(r.data?.order.status).toBe('PAID');
  });

  it('배송 중이면 DENY', async () => {
    const r = await callOk('address-change', req('coupang · 배송 중'));
    expect(r.decision).toBe('DENY');
  });
});

describe('POST /alf/orders/return-request', () => {
  it('배송완료 2일 + 단순 변심 → ALLOW, 반품 요청 표시', async () => {
    const r = await callOk('return-request', req('smartstore · 배송완료 2일(반품 가능)', { reason: 'CHANGE_OF_MIND' }));
    expect(r).toMatchObject({ decision: 'ALLOW', reasonCode: 'RETURN_WITHIN_WINDOW' });
    expect(r.data?.order.status).toBe('RETURN_REQUESTED');
  });

  it('하자는 기간 안이어도 ESCALATE', async () => {
    const r = await callOk('return-request', req('coupang · 배송완료 1일(반품 가능)', { reason: 'DEFECT' }));
    expect(r).toMatchObject({ decision: 'ESCALATE', reasonCode: 'RETURN_NEEDS_INSPECTION' });
  });

  it('기간이 지나면 거부가 아니라 ESCALATE', async () => {
    const r = await callOk(
      'return-request',
      req('coupang · 배송완료 9일(반품 기간 경과)', { reason: 'CHANGE_OF_MIND' }),
    );
    expect(r).toMatchObject({ decision: 'ESCALATE', reasonCode: 'RETURN_WINDOW_EXPIRED' });
  });

  it('사유가 없으면 400', async () => {
    expect((await call('return-request', req('coupang · 배송완료 1일(반품 가능)'))).status).toBe(400);
  });
});

describe('task_logs', () => {
  it('모든 호출(주문 없음 포함)을 chatId와 함께 기록한다', async () => {
    await callOk('cancel', req('smartstore · 발주 완료(출고 전)', { chatId: 'chat-1' }));
    await callOk('lookup', { orderNo: '1111111111111111', phoneLast4: '0000', chatId: 'chat-2' });
    const { results } = await env.DB.prepare(
      'SELECT task_name, chat_id, decision, reason_code, sales_order_id, latency_ms FROM task_logs ORDER BY id',
    ).all();
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      task_name: 'order_cancel',
      chat_id: 'chat-1',
      decision: 'ESCALATE',
      reason_code: 'SUPPLIER_ALREADY_ORDERED',
    });
    expect(results[0]?.sales_order_id).toEqual(expect.any(Number));
    expect(results[1]).toMatchObject({
      task_name: 'order_lookup',
      reason_code: 'ORDER_NOT_FOUND',
      sales_order_id: null,
    });
  });
});
