import type { ShipmentStatus } from '../../modules/orders';
import { type EngineClient, type EngineOrder, toChannel } from '../engine-client';
import type { SupplierAdapter, SupplierOrderSnapshot } from './types';

/**
 * live 공급처 어댑터. 엔진이 넣은 공급처 발주(source_order_id)와 송장을 읽는다.
 * 공급처 이름은 엔진의 소스 코드(ownerclan 등)를 그대로 쓰지 않고 SUPPLIER_<코드>로 감싼다.
 */
function shipmentStatus(o: EngineOrder): ShipmentStatus {
  if (o.status === 'DELIVERED' || o.status === 'SETTLED' || o.deliveredAt) return 'DELIVERED';
  if (o.status === 'IN_TRANSIT') return 'IN_TRANSIT';
  return 'SHIPPED';
}

export class EngineSupplier implements SupplierAdapter {
  readonly name = 'engine';

  constructor(private readonly client: EngineClient) {}

  async listChangedSupplierOrders(since: Date | null): Promise<SupplierOrderSnapshot[]> {
    const orders = await this.client.listOrders(since);
    return orders.flatMap((o) => {
      if (!o.sourceOrder) return [];
      return [
        {
          channel: toChannel(o.market),
          channelOrderId: o.marketOrderId,
          supplierCode: `SUPPLIER_${o.sourceOrder.sourceCode.toUpperCase()}`,
          supplierOrderRef: o.sourceOrder.sourceOrderId,
          status: o.tracking ? 'SHIPPED' : o.status === 'CANCELLED' ? 'CANCELLED' : 'ORDERED',
          orderedAt: o.sourceOrder.purchasedAt,
          shipment: o.tracking
            ? {
                carrier: o.tracking.carrierName,
                trackingNo: o.tracking.trackingNo,
                status: shipmentStatus(o),
                updatedAt: o.tracking.updatedAt,
              }
            : null,
          updatedAt: o.updatedAt,
        },
      ];
    });
  }
}
