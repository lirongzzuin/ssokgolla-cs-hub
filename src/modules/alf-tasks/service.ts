import type { Logger } from '../../app/logger';
import { type Action, ORDER_NOT_FOUND_MESSAGE, type OrderService, type ReturnReason } from '../orders';
import type { TaskLogRepository } from './repository';
import type { OrderRequest, TaskResponse } from './schemas';

/**
 * ALF 태스크 한 번의 처리: 본인 확인 → 정책 평가 → 기록 → ALF 응답 형식.
 * 판단은 orders 모듈이 하고, 여기서는 순서와 기록만 책임진다.
 */

export interface TaskOutcomeListener {
  /** 태스크 결과를 상담 기록(inquiries)에 반영. chatId가 있을 때만 불린다. */
  onTaskOutcome(input: {
    chatId: string;
    salesOrderId: number | null;
    decision: TaskResponse['decision'];
    reasonCode: string;
    at: Date;
  }): Promise<void>;
}

const TASK_NAME: Record<Action, string> = {
  lookup: 'order_lookup',
  cancel: 'order_cancel',
  address_change: 'order_address_change',
  return_request: 'order_return_request',
};

export function createAlfTaskService(deps: {
  orders: OrderService;
  taskLogs: TaskLogRepository;
  now: () => Date;
  log: Logger;
  outcomeListener?: TaskOutcomeListener;
}) {
  const { orders, taskLogs, now, log } = deps;

  async function record(
    action: Action,
    req: OrderRequest,
    startedAt: number,
    res: TaskResponse,
    salesOrderId: number | null,
  ) {
    const at = now();
    await taskLogs.insert({
      taskName: TASK_NAME[action],
      salesOrderId,
      chatId: req.chatId ?? null,
      decision: res.decision,
      reasonCode: res.reasonCode,
      latencyMs: Math.max(0, Date.now() - startedAt),
      createdAt: at,
    });
    if (req.chatId && deps.outcomeListener) {
      await deps.outcomeListener.onTaskOutcome({
        chatId: req.chatId,
        salesOrderId,
        decision: res.decision,
        reasonCode: res.reasonCode,
        at,
      });
    }
    // 주문번호·뒤4자리는 남기지 않는다. 추적은 chatId와 내부 id로 한다.
    log.info('alf_task', { task: TASK_NAME[action], decision: res.decision, reasonCode: res.reasonCode, salesOrderId });
  }

  async function run(action: Action, req: OrderRequest, returnReason?: ReturnReason): Promise<TaskResponse> {
    const startedAt = Date.now();
    const view = await orders.findForCustomer(req);

    if (!view) {
      // 업무상 정상 결과(고객이 번호를 잘못 입력)다. HTTP 200으로 돌려 ALF가 실패 분기가 아니라 "다시 묻기"로 가게 한다.
      const res: TaskResponse = {
        ok: false,
        decision: 'DENY',
        reasonCode: 'ORDER_NOT_FOUND',
        customerMessage: ORDER_NOT_FOUND_MESSAGE,
        data: null,
      };
      await record(action, req, startedAt, res, null);
      return res;
    }

    const ev = await orders.evaluate(action, view, { returnReason });
    const res: TaskResponse = {
      ok: true,
      decision: ev.decision,
      reasonCode: ev.reasonCode,
      customerMessage: ev.customerMessage,
      data: { order: ev.publicOrder },
    };
    await record(action, req, startedAt, res, ev.orderId);
    return res;
  }

  return {
    lookup: (req: OrderRequest) => run('lookup', req),
    cancel: (req: OrderRequest) => run('cancel', req),
    addressChange: (req: OrderRequest) => run('address_change', req),
    returnRequest: (req: OrderRequest & { reason: ReturnReason }) => run('return_request', req, req.reason),
  };
}

export type AlfTaskService = ReturnType<typeof createAlfTaskService>;
