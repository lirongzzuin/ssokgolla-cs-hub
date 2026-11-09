import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createOrderRepository, type SalesOrderInput } from '../../src/modules/orders';

const repo = createOrderRepository(env.DB);
const T0 = new Date('2026-11-01T00:00:00Z');
const later = (min: number) => new Date(T0.getTime() + min * 60_000);

const base: SalesOrderInput = {
  channel: 'smartstore',
  channelOrderId: '2026110100009999',
  productName: '테스트 상품',
  optionName: null,
  qty: 1,
  buyerNameMasked: '홍*동',
  phoneLast4: '0000',
  status: 'PAID',
  needsReview: false,
  orderedAt: T0,
  deliveredAt: null,
  updatedAt: T0,
};

beforeEach(async () => {
  await env.DB.exec('DELETE FROM shipments; DELETE FROM supplier_orders; DELETE FROM sales_orders;');
});

describe('orders repository', () => {
  it('주문번호와 뒤 4자리가 모두 맞아야 찾는다', async () => {
    await repo.upsertSalesOrder(base);
    expect(await repo.findForCustomer('2026110100009999', '0000')).not.toBeNull();
    expect(await repo.findForCustomer('2026110100009999', '9999')).toBeNull();
    expect(await repo.findForCustomer('2026110100000000', '0000')).toBeNull();
  });

  it('채널을 주면 그 채널에서만 찾는다', async () => {
    await repo.upsertSalesOrder(base);
    expect(await repo.findForCustomer(base.channelOrderId, '0000', 'coupang')).toBeNull();
    expect(await repo.findForCustomer(base.channelOrderId, '0000', 'smartstore')).not.toBeNull();
  });

  it('upsert는 더 최근에 바뀐 쪽이 이긴다(허브의 요청 표시를 오래된 원천 데이터가 덮지 않는다)', async () => {
    const id = await repo.upsertSalesOrder(base);
    await repo.updateStatus(id, 'CANCEL_REQUESTED', later(10));

    // 원천이 요청 이전 시각의 데이터를 다시 보냄 → 유지
    expect(await repo.upsertSalesOrder({ ...base, updatedAt: later(5) })).toBe(id);
    expect((await repo.findForCustomer(base.channelOrderId, '0000'))?.status).toBe('CANCEL_REQUESTED');

    // 원천에서 실제로 취소됨(요청 이후) → 반영
    await repo.upsertSalesOrder({ ...base, status: 'CANCELLED', updatedAt: later(20) });
    expect((await repo.findForCustomer(base.channelOrderId, '0000'))?.status).toBe('CANCELLED');
  });

  it('getView는 최신 공급처 주문과 송장을 붙인다', async () => {
    const id = await repo.upsertSalesOrder({ ...base, status: 'SHIPPED' });
    await repo.upsertSupplierOrder({
      salesOrderId: id,
      supplierCode: 'SUPPLIER_A',
      supplierOrderRef: 'PO-1',
      status: 'SHIPPED',
      orderedAt: later(60),
    });
    await repo.upsertShipment({
      salesOrderId: id,
      carrier: 'CJ대한통운',
      trackingNo: '500000000001',
      status: 'SHIPPED',
      updatedAt: later(120),
    });
    const order = await repo.findForCustomer(base.channelOrderId, '0000');
    if (!order) throw new Error('order not found');
    const view = await repo.getView(order);
    expect(view.supplierOrder?.supplierCode).toBe('SUPPLIER_A');
    expect(view.shipment?.trackingNo).toBe('500000000001');
    expect(view.order.updatedAt).toBeInstanceOf(Date);
  });
});
