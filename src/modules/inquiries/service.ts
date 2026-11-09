import type { Logger } from '../../app/logger';
import type { InquiryRepository } from './repository';

/**
 * 상담 로그. 채널톡 웹훅 이벤트와 ALF 태스크 결과를 상담(inquiries) 한 줄로 모은다.
 *
 * 채널톡 문서에 "ALF가 처리했다/상담원이 처리했다"를 알려주는 필드가 없어서(docs/architecture.md §6.2)
 * 아래 규칙으로 판별한다.
 *  - 상담원(personType=manager) 메시지가 하나라도 있으면 handled_by=agent, escalated=1
 *  - 태스크가 ESCALATE를 받으면 escalated=1, 사유 = reasonCode
 *  - 그 외는 ALF가 끝낸 상담(handled_by=alf)
 */

/** 채널톡 형식을 모르는 정규화된 이벤트. channeltalk 모듈이 웹훅 본문을 이 형태로 바꿔 넘긴다. */
export type ChatEvent =
  | { kind: 'chat_opened'; chatId: string; at: Date }
  | { kind: 'message'; chatId: string; sender: 'user' | 'bot' | 'manager'; text: string | null; at: Date };

/** 태스크 이름 → 문의 분류 */
const TASK_CATEGORY: Record<string, string> = {
  order_lookup: 'ORDER_STATUS',
  order_cancel: 'CANCEL',
  order_address_change: 'ADDRESS_CHANGE',
  order_return_request: 'RETURN',
};

export interface ChatMessageListener {
  /** 상담에 bot/manager 메시지가 올라옴(쿠팡 브릿지가 답변을 쿠팡에 되돌리는 데 씀) */
  onReply(chatId: string, text: string, at: Date): Promise<void>;
}

export function createInquiryService(deps: {
  repo: InquiryRepository;
  log: Logger;
  replyListener?: ChatMessageListener;
}) {
  const { repo, log } = deps;

  return {
    async handleChatEvent(ev: ChatEvent): Promise<void> {
      await repo.ensure('channeltalk', ev.chatId, ev.at);
      if (ev.kind !== 'message') return;
      if (ev.sender === 'manager') await repo.markAgentJoined('channeltalk', ev.chatId);
      if (ev.sender !== 'user' && ev.text && deps.replyListener) {
        await deps.replyListener.onReply(ev.chatId, ev.text, ev.at);
      }
    },

    /** alf-tasks의 TaskOutcomeListener 구현. 상담이 웹훅보다 먼저 태스크로 들어와도 되도록 ensure 먼저. */
    async onTaskOutcome(input: {
      taskName: string;
      chatId: string;
      salesOrderId: number | null;
      decision: string;
      reasonCode: string;
      at: Date;
    }): Promise<void> {
      await repo.ensure('channeltalk', input.chatId, input.at);
      await repo.applyTaskOutcome({
        chatId: input.chatId,
        salesOrderId: input.salesOrderId,
        category: TASK_CATEGORY[input.taskName] ?? 'UNKNOWN',
        escalationReason: input.decision === 'ESCALATE' ? input.reasonCode : null,
      });
      log.debug('inquiry_task_outcome', { chatId: input.chatId, decision: input.decision });
    },
  };
}

export type InquiryService = ReturnType<typeof createInquiryService>;
