import type { Channel, ShipmentStatus, SupplierOrderStatus } from '../../modules/orders';

/**
 * 공급처 어댑터 인터페이스. 판매채널 주문(channel + channelOrderId)에 대해 판매자가 넣은 발주와 송장을 돌려준다.
 * 공급처 이름은 코드(SUPPLIER_A 등)로만 다룬다.
 */
export interface SupplierOrderSnapshot {
  channel: Channel;
  channelOrderId: string;
  supplierCode: string;
  supplierOrderRef: string;
  status: SupplierOrderStatus;
  orderedAt: Date;
  shipment: {
    carrier: string;
    trackingNo: string;
    status: ShipmentStatus;
    updatedAt: Date;
  } | null;
  updatedAt: Date;
}

export interface SupplierAdapter {
  readonly name: string;
  listChangedSupplierOrders(since: Date | null): Promise<SupplierOrderSnapshot[]>;
}
