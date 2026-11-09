import type { Channel, OrderView, PolicyResult, ReasonCode } from './types';

/**
 * 고객에게 그대로 보여줄 문장. ALF가 고쳐 쓰지 않아도 되도록 완성된 문장으로 만든다.
 *
 * 작성 규칙(테스트로 검증):
 *  1. 공급처 이름·공급처 주문번호·매입가 등 위탁판매 내부 정보를 쓰지 않는다. "공급처"라는 단어도 쓰지 않는다.
 *  2. 송장에 근거 없는 도착 예정일을 약속하지 않는다.
 *  3. ESCALATE는 "담당자가 확인 후 안내드리겠습니다"로 끝낸다.
 */

export const ESCALATE_SUFFIX = '담당자가 확인 후 안내드리겠습니다.';

const CHANNEL_LABEL: Record<Channel, string> = {
  smartstore: '네이버 스마트스토어',
  coupang: '쿠팡',
};

/** 고객이 직접 처리하는 위치. 판매자 API로 대신 처리하지 않는다(docs/architecture.md D2). */
const SELF_SERVICE: Record<Channel, string> = {
  smartstore: '네이버페이 주문내역',
  coupang: '쿠팡 마이쿠팡 > 주문목록',
};

type MessageBuilder = (view: OrderView) => string;

const shipmentLine = (view: OrderView): string =>
  view.shipment ? `배송 조회: ${view.shipment.carrier} ${view.shipment.trackingNo}` : '';

const MESSAGES: Record<ReasonCode, MessageBuilder> = {
  CANCELABLE_BEFORE_SUPPLIER_ORDER: ({ order }) =>
    `아직 상품 준비 전이라 바로 취소하실 수 있어요. ${SELF_SERVICE[order.channel]}에서 '취소 요청'을 눌러 주시면 즉시 처리됩니다.`,
  ADDRESS_CHANGEABLE_BEFORE_SUPPLIER_ORDER: ({ order }) =>
    `아직 상품 준비 전이라 배송지를 바꾸실 수 있어요. ${SELF_SERVICE[order.channel]}에서 배송지를 변경해 주세요. 변경이 안 보이면 말씀해 주세요.`,
  RETURN_WITHIN_WINDOW: ({ order }) =>
    `반품 가능 기간 안이에요. ${SELF_SERVICE[order.channel]}에서 '반품 신청'을 해주시면 회수 안내가 진행됩니다. 단순 변심 반품은 왕복 배송비가 부과될 수 있어요.`,

  SUPPLIER_ALREADY_ORDERED: () => `상품 출고 준비가 이미 시작되어 바로 처리하기 어려울 수 있어요. ${ESCALATE_SUFFIX}`,
  RETURN_WINDOW_EXPIRED: () => `반품 가능 기간이 지나 확인이 필요해요. ${ESCALATE_SUFFIX}`,
  RETURN_NEEDS_INSPECTION: () =>
    `불편을 드려 죄송합니다. 상품 상태 확인이 필요해요. 가능하시면 상품 사진을 이 채팅에 남겨 주세요. ${ESCALATE_SUFFIX}`,
  DELIVERY_DATE_UNKNOWN: () => `배송 완료 일자 확인이 필요해요. ${ESCALATE_SUFFIX}`,
  MANUAL_REVIEW_REQUIRED: () => `주문 상태 확인이 필요해요. ${ESCALATE_SUFFIX}`,

  ALREADY_SHIPPED: (view) =>
    `상품이 이미 출고되어 취소나 배송지 변경이 어려워요. 받으신 뒤 반품 신청을 해주세요. ${shipmentLine(view)}`.trim(),
  ALREADY_DELIVERED: ({ order }) =>
    `이미 배송이 완료된 주문이에요. 취소 대신 ${SELF_SERVICE[order.channel]}에서 반품 신청을 해주세요.`,
  NOT_SHIPPED_USE_CANCEL: () => `아직 출고 전이라 반품이 아니라 취소로 진행해야 해요. 취소를 도와드릴까요?`,
  NOT_DELIVERED_YET: (view) => `아직 배송 중이라 받으신 뒤 반품 신청을 하실 수 있어요. ${shipmentLine(view)}`.trim(),
  CANCEL_IN_PROGRESS: () => `이미 취소 요청이 접수되어 처리 중이에요.`,
  RETURN_IN_PROGRESS: () => `이미 반품 요청이 접수되어 처리 중이에요.`,
  ALREADY_CANCELLED: () => `이미 취소된 주문이에요. 환불 일정은 결제 수단에 따라 다를 수 있어요.`,
  ALREADY_RETURNED: () => `이미 반품이 완료된 주문이에요.`,

  STATUS_PREPARING: () => `주문하신 상품을 출고 준비 중이에요. 출고되면 송장번호를 알려드릴게요.`,
  STATUS_SHIPPING: (view) => `상품이 출고되어 배송 중이에요. ${shipmentLine(view)}`.trim(),
  STATUS_DELIVERED: () => `배송이 완료된 주문이에요. 받지 못하셨다면 말씀해 주세요.`,
  STATUS_CANCEL_REQUESTED: () => `취소 요청이 접수되어 처리 중이에요.`,
  STATUS_CANCELLED: () => `취소된 주문이에요.`,
  STATUS_RETURN_REQUESTED: () => `반품 요청이 접수되어 처리 중이에요.`,
  STATUS_RETURNED: () => `반품이 완료된 주문이에요.`,
};

export function buildCustomerMessage(view: OrderView, result: PolicyResult): string {
  return MESSAGES[result.reasonCode](view);
}

export const ORDER_NOT_FOUND_MESSAGE =
  '주문 정보를 찾지 못했어요. 주문번호와 주문하실 때 입력한 휴대폰 번호 뒤 4자리를 다시 확인해 주세요.';

export function channelLabel(channel: Channel): string {
  return CHANNEL_LABEL[channel];
}
