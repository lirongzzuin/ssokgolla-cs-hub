/**
 * mock 주문 20건을 D1에 넣는다.
 *   npm run seed          (로컬)  = node scripts/seed.ts && wrangler d1 execute cs-hub --local  --file .wrangler/seed.sql
 *   npm run seed:remote   (배포)  = node scripts/seed.ts && wrangler d1 execute cs-hub --remote --file .wrangler/seed.sql
 *
 * mock 어댑터와 같은 데이터(src/adapters/mock-fixtures.ts)를 쓴다. 시각은 실행 시점 기준 상대값이다.
 *
 * 지우지 않고 upsert 한다. mock 주문 20건만 처음 상태로 되돌리고(취소 요청 표시 등 초기화),
 * 상담(inquiries)·태스크 기록(task_logs)은 남긴다. 테스트 30문항을 다시 채점하려고 seed를 다시 돌려도
 * v1 운영 기록과 주문 연결(sales_order_id)이 유지되게 하기 위해서다.
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
const values = (...vs: Array<string | number | boolean | null | undefined>) => vs.map(q).join(', ');
/** 같은 키면 무조건 덮어쓴다(동기화의 "최근 것이 이긴다" 조건 없이) → 처음 상태로 초기화 */
const overwrite = (cols: string[]) => cols.map((c) => `${c} = excluded.${c}`).join(', ');

const SALES_COLS = [
  'product_name',
  'option_name',
  'qty',
  'buyer_name_masked',
  'phone_last4',
  'status',
  'needs_review',
  'ordered_at',
  'delivered_at',
  'updated_at',
];

const lines: string[] = [];
const fixtures = buildMockOrders(now);

for (const { sales: s, supplier } of fixtures) {
  const status = deriveStatus(s.status, supplier?.status ?? null);
  lines.push(
    `INSERT INTO sales_orders (channel, channel_order_id, ${SALES_COLS.join(', ')}) VALUES (${values(
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
    )}) ON CONFLICT (channel, channel_order_id) DO UPDATE SET ${overwrite(SALES_COLS)};`,
  );
  if (!supplier) continue;

  const salesId = `(SELECT id FROM sales_orders WHERE channel = ${q(s.channel)} AND channel_order_id = ${q(s.channelOrderId)})`;
  lines.push(
    `INSERT INTO supplier_orders (sales_order_id, supplier_code, supplier_order_ref, status, ordered_at) VALUES (${salesId}, ${values(
      supplier.supplierCode,
      supplier.supplierOrderRef,
      supplier.status,
      iso(supplier.orderedAt),
    )}) ON CONFLICT (supplier_code, supplier_order_ref) DO UPDATE SET ${overwrite(['status', 'ordered_at'])};`,
  );
  if (supplier.shipment) {
    const sh = supplier.shipment;
    lines.push(
      `INSERT INTO shipments (sales_order_id, carrier, tracking_no, status, updated_at) VALUES (${salesId}, ${values(
        sh.carrier,
        sh.trackingNo,
        sh.status,
        iso(sh.updatedAt),
      )}) ON CONFLICT (carrier, tracking_no) DO UPDATE SET ${overwrite(['status', 'updated_at'])};`,
    );
  }
}

// seed 직후 첫 동기화가 같은 데이터를 다시 가져오지 않도록 커서를 지금으로 둔다
lines.push(
  `INSERT INTO sync_state (name, cursor, updated_at) VALUES ('orders', ${values(iso(now), iso(now))}) ON CONFLICT (name) DO UPDATE SET ${overwrite(['cursor', 'updated_at'])};`,
);

mkdirSync('.wrangler', { recursive: true });
writeFileSync('.wrangler/seed.sql', `${lines.join('\n')}\n`);

console.log(`seed: mock 주문 ${fixtures.length}건 → .wrangler/seed.sql (상담·태스크 기록은 유지)`);
for (const f of fixtures) {
  console.log(`  ${f.sales.channelOrderId.padEnd(16)}  뒤4자리 ${f.sales.phoneLast4}  ${f.scenario}`);
}
