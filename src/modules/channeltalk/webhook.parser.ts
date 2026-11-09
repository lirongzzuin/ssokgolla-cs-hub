import { z } from 'zod';
import type { ChatEvent } from '../inquiries';

/**
 * 채널톡 웹훅 본문 → 정규화된 ChatEvent. 채널톡 형식은 이 파일 밖으로 나가지 않는다.
 *
 * 확인한 것 (https://developers.channel.io/en/articles/Webhook-events-7bd9b8e2 , 확인 2026-11-09)
 *   - 최상위 키: event("upsert" | "update" | "push"), type("Message" | "UserChat" | "User"), entity, refers
 *   - Message: chatType("group" | "userChat"), personType("manager" | "bot" | "user")
 * 확인하지 못한 것
 *   TODO(verify-api): entity 안의 필드 이름. 문서 예시 JSON을 읽지 못해 아래 이름은 실제 페이로드로 확인해야 한다.
 *     - Message: entity.chatId, entity.plainText, entity.createdAt(ms)
 *     - UserChat: entity.id, entity.createdAt(ms)
 *   확인 전까지 필드가 없으면 이벤트를 무시한다(200 응답). 잘못 추측한 값을 저장하지 않기 위해서다.
 */

const messageEntity = z.looseObject({
  chatId: z.string().min(1),
  chatType: z.string(),
  personType: z.enum(['user', 'bot', 'manager']),
  plainText: z.string().optional(),
  createdAt: z.number().optional(),
});

const userChatEntity = z.looseObject({
  id: z.string().min(1),
  createdAt: z.number().optional(),
});

const envelope = z.looseObject({
  event: z.string().optional(),
  type: z.string(),
  entity: z.unknown(),
});

export type ParseResult = { event: ChatEvent } | { ignored: string };

export function parseWebhook(body: unknown, now: Date): ParseResult {
  const env = envelope.safeParse(body);
  if (!env.success) return { ignored: 'invalid_envelope' };

  if (env.data.type === 'Message') {
    const m = messageEntity.safeParse(env.data.entity);
    if (!m.success) return { ignored: 'message_fields_missing' };
    // 팀 채팅(group) 메시지는 고객 상담이 아니다
    if (m.data.chatType !== 'userChat') return { ignored: 'not_user_chat' };
    return {
      event: {
        kind: 'message',
        chatId: m.data.chatId,
        sender: m.data.personType,
        text: m.data.plainText?.trim() || null,
        at: m.data.createdAt ? new Date(m.data.createdAt) : now,
      },
    };
  }

  if (env.data.type === 'UserChat') {
    const u = userChatEntity.safeParse(env.data.entity);
    if (!u.success) return { ignored: 'userchat_fields_missing' };
    return {
      event: { kind: 'chat_opened', chatId: u.data.id, at: u.data.createdAt ? new Date(u.data.createdAt) : now },
    };
  }

  return { ignored: `unsupported_type:${env.data.type}` };
}
