/**
 * mock 주문 20건을 로컬 D1에 넣는다.
 *   npm run seed   (= node scripts/seed.ts && wrangler d1 execute cs-hub --local --file .wrangler/seed.sql)
 *
 * mock 어댑터와 같은 데이터(src/adapters/mock-fixtures.ts)를 쓴다. 시각은 실행 시점 기준 상대값이다.
 * 기존 주문·상담·태스크 기록을 지우고 다시 넣는다(로컬 전용).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildMockOrders } from '../src/adapters/mock-fixtures.ts';
import { deriveStatus } from '../src/modules/orders/status.ts';

const now = new Date();
const q = (v: string | number | boolean | null | undefined): string => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  return `'${v.replaceAll("'", "''")}'`;
};
const iso = (d: Date | null) => (d ? d.toISOString() : null);

const lines: string[] = [
  'DELETE FROM task_logs;',
  'DELETE FROM inquiries;',
  'DELETE FROM shipments;',
  'DELETE FROM supplier_orders;',
  'DELETE FROM sales_orders;',
  'DELETE FROM sync_state;',
];

const fixtures = buildMockOrders(now);
for (const { sales: s, supplier } of fixtures) {
  const status = deriveStatus(s.status, supplier?.status ?? null);
  lines.push(
    `INSERT INTO sales_orders (channel, channel_order_id, product_name, option_name, qty, buyer_name_masked, phone_last4, status, needs_review, ordered_at, delivered_at, updated_at) VALUES (${[
      s.channel,
      s.channelOrderId,
      s.productName,
      s.optionName,
      s.qty,
      s.buyerNameMasked,
      s.phoneLast4,
      status,
      s.needsReview,
      iso(s.orderedAt),
      iso(s.deliveredAt),
      iso(s.updatedAt),
    ]
      .map(q)
      .join(', ')});`,
  );
  if (!supplier) continue;
  const salesId = `(SELECT id FROM sales_orders WHERE channel = ${q(s.channel)} AND channel_order_id = ${q(s.channelOrderId)})`;
  lines.push(
    `INSERT INTO supplier_orders (sales_order_id, supplier_code, supplier_order_ref, status, ordered_at) VALUES (${salesId}, ${[
      supplier.supplierCode,
      supplier.supplierOrderRef,
      supplier.status,
      iso(supplier.orderedAt),
    ]
      .map(q)
      .join(', ')});`,
  );
  if (supplier.shipment) {
    const sh = supplier.shipment;
    lines.push(
      `INSERT INTO shipments (sales_order_id, carrier, tracking_no, status, updated_at) VALUES (${salesId}, ${[
        sh.carrier,
        sh.trackingNo,
        sh.status,
        iso(sh.updatedAt),
      ]
        .map(q)
        .join(', ')});`,
    );
  }
}
// seed 직후 첫 동기화가 같은 데이터를 다시 가져오지 않도록 커서를 지금으로 둔다
lines.push(`INSERT INTO sync_state (name, cursor, updated_at) VALUES ('orders', ${q(iso(now))}, ${q(iso(now))});`);

mkdirSync('.wrangler', { recursive: true });
writeFileSync('.wrangler/seed.sql', `${lines.join('\n')}\n`);

console.log(`seed: 주문 ${fixtures.length}건 → .wrangler/seed.sql`);
for (const f of fixtures) {
  console.log(`  ${f.sales.channelOrderId}  뒤4자리 ${f.sales.phoneLast4}  ${f.scenario}`);
}
