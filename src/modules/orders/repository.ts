import type {
  Channel,
  OrderStatus,
  OrderView,
  SalesOrder,
  Shipment,
  ShipmentStatus,
  SupplierOrder,
  SupplierOrderStatus,
} from './types';

/**
 * D1 접근. SQL과 행 ↔ 도메인 변환만 하고 판단은 하지 않는다.
 * 날짜는 ISO 문자열로 저장한다(0001_init.sql 주석 참고).
 */

interface SalesOrderRow {
  id: number;
  channel: Channel;
  channel_order_id: string;
  product_name: string;
  option_name: string | null;
  qty: number;
  buyer_name_masked: string;
  phone_last4: string;
  status: OrderStatus;
  needs_review: number;
  ordered_at: string;
  delivered_at: string | null;
  updated_at: string;
}

const toDate = (s: string) => new Date(s);
const toDateOrNull = (s: string | null) => (s ? new Date(s) : null);

function toSalesOrder(r: SalesOrderRow): SalesOrder {
  return {
    id: r.id,
    channel: r.channel,
    channelOrderId: r.channel_order_id,
    productName: r.product_name,
    optionName: r.option_name,
    qty: r.qty,
    buyerNameMasked: r.buyer_name_masked,
    phoneLast4: r.phone_last4,
    status: r.status,
    needsReview: r.needs_review === 1,
    orderedAt: toDate(r.ordered_at),
    deliveredAt: toDateOrNull(r.delivered_at),
    updatedAt: toDate(r.updated_at),
  };
}

/** 동기화가 넣는 주문 한 건(id 없음) */
export type SalesOrderInput = Omit<SalesOrder, 'id'>;

export interface SupplierOrderInput extends SupplierOrder {
  salesOrderId: number;
}

export interface ShipmentInput extends Shipment {
  salesOrderId: number;
}

export function createOrderRepository(db: D1Database) {
  return {
    /**
     * 본인 확인 조회. 주문번호와 뒤 4자리가 모두 맞아야 찾는다.
     * 둘 중 무엇이 틀렸는지 구분하지 않는다(주문번호 존재 여부를 알려주지 않기 위해).
     */
    async findForCustomer(orderNo: string, phoneLast4: string, channel?: Channel): Promise<SalesOrder | null> {
      const row = await db
        .prepare(
          `SELECT * FROM sales_orders
           WHERE channel_order_id = ?1 AND phone_last4 = ?2 AND (?3 IS NULL OR channel = ?3)
           ORDER BY ordered_at DESC LIMIT 1`,
        )
        .bind(orderNo, phoneLast4, channel ?? null)
        .first<SalesOrderRow>();
      return row ? toSalesOrder(row) : null;
    },

    async findIdByChannelOrderId(channel: Channel, channelOrderId: string): Promise<number | null> {
      const row = await db
        .prepare('SELECT id FROM sales_orders WHERE channel = ?1 AND channel_order_id = ?2')
        .bind(channel, channelOrderId)
        .first<{ id: number }>();
      return row?.id ?? null;
    },

    async getView(order: SalesOrder): Promise<OrderView> {
      const [supplier, shipment] = await Promise.all([
        db
          .prepare(
            `SELECT supplier_code, supplier_order_ref, status, ordered_at FROM supplier_orders
             WHERE sales_order_id = ?1 ORDER BY ordered_at DESC LIMIT 1`,
          )
          .bind(order.id)
          .first<{
            supplier_code: string;
            supplier_order_ref: string;
            status: SupplierOrderStatus;
            ordered_at: string;
          }>(),
        db
          .prepare(
            `SELECT carrier, tracking_no, status, updated_at FROM shipments
             WHERE sales_order_id = ?1 ORDER BY updated_at DESC LIMIT 1`,
          )
          .bind(order.id)
          .first<{ carrier: string; tracking_no: string; status: ShipmentStatus; updated_at: string }>(),
      ]);
      return {
        order,
        supplierOrder: supplier
          ? {
              supplierCode: supplier.supplier_code,
              supplierOrderRef: supplier.supplier_order_ref,
              status: supplier.status,
              orderedAt: toDate(supplier.ordered_at),
            }
          : null,
        shipment: shipment
          ? {
              carrier: shipment.carrier,
              trackingNo: shipment.tracking_no,
              status: shipment.status,
              updatedAt: toDate(shipment.updated_at),
            }
          : null,
      };
    },

    async updateStatus(id: number, status: OrderStatus, now: Date): Promise<void> {
      await db
        .prepare('UPDATE sales_orders SET status = ?1, updated_at = ?2 WHERE id = ?3')
        .bind(status, now.toISOString(), id)
        .run();
    },

    /**
     * 동기화 upsert. "더 최근에 바뀐 쪽이 이긴다".
     * 허브가 표시한 CANCEL_REQUESTED 등은 원천의 updatedAt이 그 뒤일 때만 덮어쓴다.
     * @returns 저장된 주문 id
     */
    async upsertSalesOrder(o: SalesOrderInput): Promise<number> {
      const row = await db
        .prepare(
          `INSERT INTO sales_orders (channel, channel_order_id, product_name, option_name, qty, buyer_name_masked,
             phone_last4, status, needs_review, ordered_at, delivered_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
           ON CONFLICT (channel, channel_order_id) DO UPDATE SET
             product_name = excluded.product_name, option_name = excluded.option_name, qty = excluded.qty,
             buyer_name_masked = excluded.buyer_name_masked, phone_last4 = excluded.phone_last4,
             status = excluded.status, needs_review = excluded.needs_review,
             delivered_at = excluded.delivered_at, updated_at = excluded.updated_at
           WHERE excluded.updated_at > sales_orders.updated_at
           RETURNING id`,
        )
        .bind(
          o.channel,
          o.channelOrderId,
          o.productName,
          o.optionName,
          o.qty,
          o.buyerNameMasked,
          o.phoneLast4,
          o.status,
          o.needsReview ? 1 : 0,
          o.orderedAt.toISOString(),
          o.deliveredAt?.toISOString() ?? null,
          o.updatedAt.toISOString(),
        )
        .first<{ id: number }>();
      // 갱신 조건에 걸려 아무것도 바뀌지 않으면 RETURNING이 비므로 id를 따로 찾는다
      const id = row?.id ?? (await this.findIdByChannelOrderId(o.channel, o.channelOrderId));
      if (id === null) throw new Error(`sales_orders upsert 실패: ${o.channel}/${o.channelOrderId}`);
      return id;
    },

    /**
     * 판매채널 쪽 변화 없이 공급처 발주만 새로 들어온 경우. 발주 전(PAID)이던 주문만 발주 후로 올린다.
     * 다른 상태(취소 요청 등)는 건드리지 않는다.
     */
    async promoteToSupplierOrdered(id: number, now: Date): Promise<void> {
      await db
        .prepare(
          `UPDATE sales_orders SET status = 'SUPPLIER_ORDERED', updated_at = ?2 WHERE id = ?1 AND status = 'PAID'`,
        )
        .bind(id, now.toISOString())
        .run();
    },

    async upsertSupplierOrder(s: SupplierOrderInput): Promise<void> {
      await db
        .prepare(
          `INSERT INTO supplier_orders (sales_order_id, supplier_code, supplier_order_ref, status, ordered_at)
           VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT (supplier_code, supplier_order_ref) DO UPDATE SET status = excluded.status`,
        )
        .bind(s.salesOrderId, s.supplierCode, s.supplierOrderRef, s.status, s.orderedAt.toISOString())
        .run();
    },

    async upsertShipment(s: ShipmentInput): Promise<void> {
      await db
        .prepare(
          `INSERT INTO shipments (sales_order_id, carrier, tracking_no, status, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT (carrier, tracking_no) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
        )
        .bind(s.salesOrderId, s.carrier, s.trackingNo, s.status, s.updatedAt.toISOString())
        .run();
    },
  };
}

export type OrderRepository = ReturnType<typeof createOrderRepository>;
