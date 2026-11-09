import { env } from 'cloudflare:test';
import { buildMockOrders } from '../src/adapters/mock-fixtures';
import { createOrderRepository, deriveStatus } from '../src/modules/orders';

/** 테스트마다 깨끗한 DB에 mock 20건을 넣는다(seed 스크립트와 같은 데이터) */
export async function resetAndSeed(now = new Date()) {
  await env.DB.exec(
    'DELETE FROM coupang_bridge_links; DELETE FROM task_logs; DELETE FROM inquiries; DELETE FROM shipments; DELETE FROM supplier_orders; DELETE FROM sales_orders; DELETE FROM sync_state;',
  );
  const repo = createOrderRepository(env.DB);
  const fixtures = buildMockOrders(now);
  for (const f of fixtures) {
    const id = await repo.upsertSalesOrder({
      ...f.sales,
      status: deriveStatus(f.sales.status, f.supplier?.status ?? null),
    });
    if (!f.supplier) continue;
    await repo.upsertSupplierOrder({ salesOrderId: id, ...f.supplier });
    if (f.supplier.shipment) await repo.upsertShipment({ salesOrderId: id, ...f.supplier.shipment });
  }
  return fixtures;
}

/** 시나리오 이름으로 mock 주문 찾기 */
export function fixture(fixtures: ReturnType<typeof buildMockOrders>, scenario: string) {
  const f = fixtures.find((x) => x.scenario === scenario);
  if (!f) throw new Error(`fixture 없음: ${scenario}`);
  return f;
}
