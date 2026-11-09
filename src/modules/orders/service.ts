import { buildCustomerMessage } from './messages';
import { decide } from './policy';
import type { PolicyConfig } from './policy.config';
import type { OrderRepository } from './repository';
import { STATUS_LABEL } from './status';
import type { Action, Channel, Decision, OrderStatus, OrderView, ReasonCode, ReturnReason } from './types';

/**
 * 주문 서비스: 조회 → 정책 판단 → 고객 문장 → (허용 시) 요청 표시.
 * HTTP·ALF 형식을 모른다. alf-tasks가 이 결과를 응답 형식으로 감싼다.
 */

export interface CustomerOrderQuery {
  orderNo: string;
  phoneLast4: string;
  channel?: Channel;
}

export interface Evaluation {
  orderId: number;
  decision: Decision;
  reasonCode: ReasonCode;
  customerMessage: string;
  /** 고객에게 보여줘도 되는 값만. 공급처 정보는 넣지 않는다. */
  publicOrder: PublicOrder;
}

export interface PublicOrder {
  channel: Channel;
  orderNo: string;
  productName: string;
  optionName: string | null;
  qty: number;
  status: OrderStatus;
  statusLabel: string;
  shipment: { carrier: string; trackingNo: string } | null;
}

/** ALLOW일 때 허브 내부에 남기는 표시. 실제 처리는 고객이 판매채널 앱에서 한다(D2). */
const REQUESTED_STATUS: Partial<Record<Action, OrderStatus>> = {
  cancel: 'CANCEL_REQUESTED',
  return_request: 'RETURN_REQUESTED',
};

export function toPublicOrder(view: OrderView): PublicOrder {
  const { order, shipment } = view;
  return {
    channel: order.channel,
    orderNo: order.channelOrderId,
    productName: order.productName,
    optionName: order.optionName,
    qty: order.qty,
    status: order.status,
    statusLabel: STATUS_LABEL[order.status],
    shipment: shipment ? { carrier: shipment.carrier, trackingNo: shipment.trackingNo } : null,
  };
}

export function createOrderService(deps: { repo: OrderRepository; now: () => Date; policyConfig?: PolicyConfig }) {
  const { repo, now } = deps;

  return {
    /** 본인 확인을 통과한 주문만 돌려준다. 없으면 null(이유는 구분하지 않음). */
    async findForCustomer(q: CustomerOrderQuery): Promise<OrderView | null> {
      const order = await repo.findForCustomer(q.orderNo, q.phoneLast4, q.channel);
      return order ? repo.getView(order) : null;
    },

    async evaluate(action: Action, view: OrderView, opts: { returnReason?: ReturnReason } = {}): Promise<Evaluation> {
      const at = now();
      const result = decide(action, view.order, {
        now: at,
        returnReason: opts.returnReason,
        config: deps.policyConfig,
      });
      const customerMessage = buildCustomerMessage(view, result);

      let current = view;
      const requested = REQUESTED_STATUS[action];
      if (result.decision === 'ALLOW' && requested) {
        await repo.updateStatus(view.order.id, requested, at);
        current = { ...view, order: { ...view.order, status: requested, updatedAt: at } };
      }

      return {
        orderId: view.order.id,
        decision: result.decision,
        reasonCode: result.reasonCode,
        customerMessage,
        publicOrder: toPublicOrder(current),
      };
    },
  };
}

export type OrderService = ReturnType<typeof createOrderService>;
