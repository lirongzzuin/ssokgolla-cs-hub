import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { MockSalesChannel } from '../../src/adapters/sales-channel/mock';
import type { SalesChannelAdapter, SalesOrderSnapshot } from '../../src/adapters/sales-channel/types';
import { MockSupplier } from '../../src/adapters/supplier/mock';
import type { SupplierAdapter, SupplierOrderSnapshot } from '../../src/adapters/supplier/types';
import { type Adapters, createContainer } from '../../src/app/container';
import { runScheduledJobs } from '../../src/app/jobs';
import { createLogger } from '../../src/app/logger';
import { MockChannelTalkClient } from '../../src/modules/channeltalk';

const silent = createLogger({}, () => {});

beforeEach(async () => {
  await env.DB.exec(
    'DELETE FROM coupang_bridge_links; DELETE FROM task_logs; DELETE FROM inquiries; DELETE FROM shipments; DELETE FROM supplier_orders; DELETE FROM sales_orders; DELETE FROM sync_state;',
  );
});

const count = async (table: string) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n;

const statusOf = async (orderNo: string) =>
  (
    await env.DB.prepare('SELECT status FROM sales_orders WHERE channel_order_id = ?1')
      .bind(orderNo)
      .first<{ status: string }>()
  )?.status;

describe('주문 동기화(mock)', () => {
  it('첫 실행은 전체, 다음 실행은 바뀐 것만(증분)', async () => {
    const c = createContainer(env, { logger: silent });
    expect(await c.sync.runOrderSync()).toEqual({ salesOrders: 20, supplierOrders: 14, shipments: 11 });
    expect(await count('sales_orders')).toBe(20);
    expect(await statusOf('2026110800000103')).toBe('SUPPLIER_ORDERED'); // 판매채널 PAID + 공급처 발주 → 발주 후

    expect(await c.sync.runOrderSync()).toEqual({ salesOrders: 0, supplierOrders: 0, shipments: 0 });
  });

  it('허브의 취소 요청 표시는 그 뒤에 바뀐 원천 데이터만 덮는다', async () => {
    const c = createContainer(env, { logger: silent });
    await c.sync.runOrderSync();
    const id = await c.orderRepo.findIdByChannelOrderId('smartstore', '2026110900000101');
    await c.orderRepo.updateStatus(id ?? 0, 'CANCEL_REQUESTED', new Date());

    // 커서를 지워 전체를 다시 가져와도(원천 updatedAt은 요청보다 과거) 표시가 남는다
    await env.DB.exec('DELETE FROM sync_state');
    await c.sync.runOrderSync();
    expect(await statusOf('2026110900000101')).toBe('CANCEL_REQUESTED');
  });
});

describe('공급처 쪽만 바뀐 주문', () => {
  const T = new Date('2026-11-09T00:00:00Z');
  const sales: SalesOrderSnapshot = {
    channel: 'coupang',
    channelOrderId: '3000000009999',
    productName: '테스트',
    optionName: null,
    qty: 1,
    buyerNameMasked: '홍*동',
    phoneLast4: '0000',
    status: 'PAID',
    needsReview: false,
    orderedAt: T,
    deliveredAt: null,
    updatedAt: T,
  };
  const supplierSnap: SupplierOrderSnapshot = {
    channel: 'coupang',
    channelOrderId: '3000000009999',
    supplierCode: 'SUPPLIER_A',
    supplierOrderRef: 'PO-9',
    status: 'ORDERED',
    orderedAt: new Date(T.getTime() + 3_600_000),
    shipment: null,
    updatedAt: new Date(T.getTime() + 3_600_000),
  };

  it('나중에 들어온 공급처 발주로 PAID → SUPPLIER_ORDERED', async () => {
    let round = 0;
    const salesAdapter: SalesChannelAdapter = {
      name: 't',
      listChangedOrders: async () => (round === 0 ? [sales] : []),
    };
    const supplierAdapter: SupplierAdapter = {
      name: 't',
      listChangedSupplierOrders: async () => (round === 0 ? [] : [supplierSnap]),
    };
    const adapters: Adapters = {
      sales: salesAdapter,
      supplier: supplierAdapter,
      coupangInquiries: new MockSalesChannel(() => T),
      channelTalk: new MockChannelTalkClient(),
    };
    const c = createContainer(env, { logger: silent, adapters });
    await c.sync.runOrderSync();
    expect(await statusOf('3000000009999')).toBe('PAID');
    round = 1;
    await c.sync.runOrderSync();
    expect(await statusOf('3000000009999')).toBe('SUPPLIER_ORDERED');
  });
});

describe('runScheduledJobs', () => {
  it('작업 하나가 실패해도 나머지는 돈다', async () => {
    const errors: string[] = [];
    const log = createLogger({}, (line, level) => level === 'error' && errors.push(line));
    const now = () => new Date();
    const adapters: Adapters = {
      sales: {
        name: 'broken',
        listChangedOrders: async () => {
          throw new Error('engine down');
        },
      },
      supplier: new MockSupplier(now),
      coupangInquiries: new MockSalesChannel(now),
      channelTalk: new MockChannelTalkClient(),
    };
    const c = createContainer({ ...env, ENABLE_COUPANG_BRIDGE: 'true' }, { logger: log, adapters });
    await runScheduledJobs(c);
    expect(errors.join('\n')).toContain('order_sync');
    // 브릿지는 실행됨(mock 문의 3건 중 상품문의 2건 브릿지)
    expect(await count('coupang_bridge_links')).toBe(2);
  });
});
