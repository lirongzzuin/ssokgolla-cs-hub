/**
 * 통합 주문 도메인 타입.
 * 판매채널 주문 + 공급처 주문 + 송장을 하나로 묶은 상태다. 외부 API 형식은 여기 들어오지 않는다(어댑터가 변환).
 */

export const CHANNELS = ['smartstore', 'coupang'] as const;
export type Channel = (typeof CHANNELS)[number];

export const ORDER_STATUSES = [
  'PAID', // 결제 완료, 공급처 발주 전
  'SUPPLIER_ORDERED', // 공급처 발주 완료, 출고 전
  'SHIPPED', // 공급처 출고, 송장 등록
  'IN_TRANSIT',
  'DELIVERED',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'RETURN_REQUESTED',
  'RETURNED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const SUPPLIER_ORDER_STATUSES = ['ORDERED', 'SHIPPED', 'CANCELLED'] as const;
export type SupplierOrderStatus = (typeof SUPPLIER_ORDER_STATUSES)[number];

export const SHIPMENT_STATUSES = ['SHIPPED', 'IN_TRANSIT', 'DELIVERED'] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export interface SalesOrder {
  id: number;
  channel: Channel;
  channelOrderId: string;
  productName: string;
  optionName: string | null;
  qty: number;
  buyerNameMasked: string;
  phoneLast4: string;
  status: OrderStatus;
  needsReview: boolean;
  orderedAt: Date;
  deliveredAt: Date | null;
  updatedAt: Date;
}

/** 내부 전용. customerMessage·ALF 응답에 절대 넣지 않는다. */
export interface SupplierOrder {
  supplierCode: string;
  supplierOrderRef: string;
  status: SupplierOrderStatus;
  orderedAt: Date;
}

export interface Shipment {
  carrier: string;
  trackingNo: string;
  status: ShipmentStatus;
  updatedAt: Date;
}

/** 정책·응답이 보는 주문 한 건의 전체 모습 */
export interface OrderView {
  order: SalesOrder;
  supplierOrder: SupplierOrder | null;
  shipment: Shipment | null;
}

// ── 정책 ──

export const ACTIONS = ['lookup', 'cancel', 'address_change', 'return_request'] as const;
export type Action = (typeof ACTIONS)[number];

/** INFO: 허용·거부 대상이 아닌 조회 응답 */
export type Decision = 'ALLOW' | 'ESCALATE' | 'DENY' | 'INFO';

export const RETURN_REASONS = ['CHANGE_OF_MIND', 'DEFECT', 'WRONG_ITEM', 'OTHER'] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

export type ReasonCode =
  // 허용
  | 'CANCELABLE_BEFORE_SUPPLIER_ORDER'
  | 'ADDRESS_CHANGEABLE_BEFORE_SUPPLIER_ORDER'
  | 'RETURN_WITHIN_WINDOW'
  // 사람 확인
  | 'SUPPLIER_ALREADY_ORDERED'
  | 'RETURN_WINDOW_EXPIRED'
  | 'RETURN_NEEDS_INSPECTION'
  | 'DELIVERY_DATE_UNKNOWN'
  | 'MANUAL_REVIEW_REQUIRED'
  // 거부
  | 'ALREADY_SHIPPED'
  | 'ALREADY_DELIVERED'
  | 'NOT_SHIPPED_USE_CANCEL'
  | 'NOT_DELIVERED_YET'
  | 'CANCEL_IN_PROGRESS'
  | 'RETURN_IN_PROGRESS'
  | 'ALREADY_CANCELLED'
  | 'ALREADY_RETURNED'
  // 조회
  | 'STATUS_PREPARING'
  | 'STATUS_SHIPPING'
  | 'STATUS_DELIVERED'
  | 'STATUS_CANCEL_REQUESTED'
  | 'STATUS_CANCELLED'
  | 'STATUS_RETURN_REQUESTED'
  | 'STATUS_RETURNED';

export interface PolicyResult {
  decision: Decision;
  reasonCode: ReasonCode;
}
