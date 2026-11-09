import type { OrderStatus, SupplierOrderStatus } from './types';

/**
 * 판매채널 상태 + 공급처 발주 여부 → 통합 상태.
 *
 * 판매채널은 "결제완료/상품준비중"까지만 알고, 판매자가 공급처에 발주했는지는 모른다.
 * 위탁판매 정책의 핵심 구분(발주 전/후)은 공급처 주문이 있어야 알 수 있으므로 여기서 합친다.
 */
export function deriveStatus(salesStatus: OrderStatus, supplierStatus: SupplierOrderStatus | null): OrderStatus {
  if (salesStatus === 'PAID' && (supplierStatus === 'ORDERED' || supplierStatus === 'SHIPPED')) {
    return 'SUPPLIER_ORDERED';
  }
  return salesStatus;
}

/** 고객에게 보여줄 상태 이름. 내부 구분(발주 전/후)은 드러내지 않는다. */
export const STATUS_LABEL: Record<OrderStatus, string> = {
  PAID: '상품 준비 중',
  SUPPLIER_ORDERED: '상품 준비 중',
  SHIPPED: '출고 완료',
  IN_TRANSIT: '배송 중',
  DELIVERED: '배송 완료',
  CANCEL_REQUESTED: '취소 요청',
  CANCELLED: '취소 완료',
  RETURN_REQUESTED: '반품 요청',
  RETURNED: '반품 완료',
};
