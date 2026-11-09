import type { SalesChannelAdapter, SalesOrderSnapshot } from '../../adapters/sales-channel/types';
import type { SupplierAdapter, SupplierOrderSnapshot } from '../../adapters/supplier/types';
import type { CursorStore } from '../../app/cursors';
import type { Logger } from '../../app/logger';
import { deriveStatus, type OrderRepository } from '../orders';

/**
 * 판매채널 주문 + 공급처 발주·송장 증분 동기화(cron).
 *
 * ALF 태스크는 60초 안에 끝나야 하므로(채널톡 Code 스텝 제한) 요청 때 외부를 부르지 않고,
 * 이 동기화가 D1에 미리 모아 둔 값을 읽는다.
 *
 * 커서는 "이번 실행을 시작한 시각"으로 저장한다. 실행 도중 바뀐 주문을 다음 실행에서 놓치지 않기 위해서다.
 */

const CURSOR = 'orders';

export interface SyncResult {
  salesOrders: number;
  supplierOrders: number;
  shipments: number;
}

const key = (s: { channel: string; channelOrderId: string }) => `${s.channel}:${s.channelOrderId}`;

export function createSyncService(deps: {
  sales: SalesChannelAdapter;
  supplier: SupplierAdapter;
  orders: OrderRepository;
  cursors: CursorStore;
  now: () => Date;
  log: Logger;
}) {
  const { sales, supplier, orders, cursors, now, log } = deps;

  async function saveSupplier(salesOrderId: number, sup: SupplierOrderSnapshot, result: SyncResult) {
    await orders.upsertSupplierOrder({ salesOrderId, ...sup });
    result.supplierOrders++;
    if (sup.shipment) {
      await orders.upsertShipment({ salesOrderId, ...sup.shipment });
      result.shipments++;
    }
  }

  async function saveSales(snap: SalesOrderSnapshot, sup: SupplierOrderSnapshot | undefined, result: SyncResult) {
    const id = await orders.upsertSalesOrder({ ...snap, status: deriveStatus(snap.status, sup?.status ?? null) });
    result.salesOrders++;
    if (sup) await saveSupplier(id, sup, result);
  }

  return {
    async runOrderSync(): Promise<SyncResult> {
      const startedAt = now();
      const since = await cursors.get(CURSOR);
      const [salesSnaps, supplierSnaps] = await Promise.all([
        sales.listChangedOrders(since),
        supplier.listChangedSupplierOrders(since),
      ]);

      const supplierByOrder = new Map(supplierSnaps.map((s) => [key(s), s]));
      const result: SyncResult = { salesOrders: 0, supplierOrders: 0, shipments: 0 };

      for (const snap of salesSnaps) {
        await saveSales(snap, supplierByOrder.get(key(snap)), result);
        supplierByOrder.delete(key(snap));
      }

      // 판매채널은 그대로인데 공급처 쪽만 바뀐 주문(발주·송장 등록)
      for (const sup of supplierByOrder.values()) {
        const id = await orders.findIdByChannelOrderId(sup.channel, sup.channelOrderId);
        if (id === null) {
          log.warn('sync_orphan_supplier_order', { channel: sup.channel, supplierCode: sup.supplierCode });
          continue;
        }
        await saveSupplier(id, sup, result);
        if (sup.status !== 'CANCELLED') await orders.promoteToSupplierOrdered(id, sup.updatedAt);
      }

      await cursors.set(CURSOR, startedAt, now());
      log.info('order_sync', { since: since?.toISOString() ?? null, ...result });
      return result;
    },
  };
}

export type SyncService = ReturnType<typeof createSyncService>;
