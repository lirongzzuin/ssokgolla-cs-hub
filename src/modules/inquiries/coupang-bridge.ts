import type { InquirySource as CoupangInquirySource } from '../../adapters/sales-channel/types';
import type { CursorStore } from '../../app/cursors';
import type { Logger } from '../../app/logger';
import type { InquiryRepository } from './repository';
import type { ChatMessageListener } from './service';

/**
 * 쿠팡 문의 브릿지 (ENABLE_COUPANG_BRIDGE, 기본 off).
 *
 * 목적: 쿠팡 상품문의도 채널톡 ALF가 답하게 해서 응대 채널을 하나로 모은다.
 *   1) cron: 쿠팡 미답변 문의 → 채널톡 상담 생성(ChatCreator) → 연결 저장
 *   2) 웹훅: 그 상담에 ALF/상담원 답변이 올라오면 → 쿠팡에 답변 등록(쿠팡 고객은 채널톡을 못 본다)
 *
 * 범위: 인터페이스와 mock만 구현한다. 채널톡 Open API로 상담을 만들 수 있는지, 그렇게 만든 상담에 ALF가
 * 실제로 응답하는지는 확인되지 않았다 → docs/channeltalk/03-tasks.md "쿠팡 브릿지 검증 체크리스트".
 *
 * 쿠팡 고객센터 이관 문의(callcenter)는 쿠팡 상담원이 넘긴 급한 건이라 ALF에 맡기지 않고 상담원 이관으로만 기록한다.
 */

/** 채널톡 상담 생성 포트. channeltalk 모듈의 클라이언트가 구현한다(의존 방향: channeltalk → inquiries). */
export interface ChatCreator {
  createChatForExternalInquiry(input: {
    source: 'coupang';
    externalId: string;
    productName: string | null;
    content: string;
  }): Promise<{ chatId: string }>;
}

const CURSOR = 'coupang_bridge';
/** 첫 실행 때 거슬러 올라갈 기간. 쿠팡 문의 조회 구간 제한(7일)보다 짧게. */
const FIRST_RUN_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export interface BridgeRunResult {
  fetched: number;
  bridged: number;
  escalatedToAgent: number;
  skipped: number;
}

export function createCoupangBridge(deps: {
  enabled: boolean;
  source: CoupangInquirySource;
  chats: ChatCreator;
  repo: InquiryRepository;
  cursors: CursorStore;
  now: () => Date;
  log: Logger;
}) {
  const { source, chats, repo, cursors, now, log } = deps;

  /**
   * 상담 1건 = inquiries 1행. 브릿지한 문의는 채널톡 상담(chatId)으로만 기록해 두 번 세지 않는다.
   * 고객센터 이관 문의는 채널톡으로 넘기지 않으므로 쿠팡 문의(source=coupang)로 기록한다.
   */
  async function bridgeOne(q: Awaited<ReturnType<CoupangInquirySource['listUnansweredInquiries']>>[number]) {
    if (q.kind === 'callcenter') {
      if (await repo.exists('coupang', q.inquiryId)) return 'skipped' as const;
      await repo.ensure('coupang', q.inquiryId, q.askedAt, 'COUPANG_CALLCENTER');
      await repo.markEscalated('coupang', q.inquiryId, 'COUPANG_CALLCENTER');
      return 'escalated' as const;
    }

    if (await repo.findBridgeLinkByInquiry(q.inquiryId)) return 'skipped' as const;
    const { chatId } = await chats.createChatForExternalInquiry({
      source: 'coupang',
      externalId: q.inquiryId,
      productName: q.productName,
      content: q.content,
    });
    await repo.ensure('channeltalk', chatId, q.askedAt, 'COUPANG_QNA');
    await repo.insertBridgeLink({ inquiryId: q.inquiryId, kind: q.kind, chatId, at: now() });
    return 'bridged' as const;
  }

  /** cron에서 호출 */
  async function run(): Promise<BridgeRunResult> {
    const result: BridgeRunResult = { fetched: 0, bridged: 0, escalatedToAgent: 0, skipped: 0 };
    if (!deps.enabled) return result;

    const startedAt = now();
    const since = (await cursors.get(CURSOR)) ?? new Date(startedAt.getTime() - FIRST_RUN_LOOKBACK_MS);
    const inquiries = await source.listUnansweredInquiries(since);
    result.fetched = inquiries.length;

    for (const q of inquiries) {
      const outcome = await bridgeOne(q);
      if (outcome === 'bridged') result.bridged++;
      else if (outcome === 'escalated') result.escalatedToAgent++;
      else result.skipped++;
    }
    await cursors.set(CURSOR, startedAt, now());
    log.info('coupang_bridge', { ...result });
    return result;
  }

  /** 웹훅에서 브릿지 상담에 답변이 올라왔을 때. 문의 하나에 한 번만 쿠팡에 답변한다. */
  const replyListener: ChatMessageListener = {
    async onReply(chatId, text, at) {
      if (!deps.enabled) return;
      const link = await repo.findBridgeLinkByChat(chatId);
      if (!link || link.answered_at) return;
      // TODO(verify-api): ALF가 인사말 등 여러 메시지를 나눠 보내면 첫 메시지만 쿠팡에 올라간다.
      //   실제 상담에서 ALF 메시지 구성을 확인한 뒤 "답변 확정" 기준(예: 특정 태그, 상담 종료)을 정할 것.
      // 먼저 표시해서 같은 상담의 메시지가 동시에 와도 한 번만 답변한다
      if (!(await repo.markBridgeAnswered(link.inquiry_id, at))) return;
      try {
        await source.answerInquiry({ inquiryId: link.inquiry_id, kind: link.inquiry_kind }, text);
      } catch (err) {
        await repo.clearBridgeAnswered(link.inquiry_id);
        throw err;
      }
      log.info('coupang_bridge_answered', { inquiryId: link.inquiry_id, chatId });
    },
  };

  return { run, replyListener };
}

export type CoupangBridge = ReturnType<typeof createCoupangBridge>;
