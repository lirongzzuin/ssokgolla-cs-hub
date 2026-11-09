import { ConfigError } from '../../app/errors';
import type { ChatCreator } from '../inquiries';

/**
 * 채널톡 Open API 클라이언트.
 *
 * 확인한 것: base URL `https://api.channel.io/open/v5`
 *   출처: https://docs.channel.io/developers/en/articles/Send-a-message-to-a-Group-64bdcedc (확인 2026-11-09)
 * 확인하지 못한 것:
 *   TODO(verify-api): Open API 인증 헤더 이름과 키 발급 위치(api-doc.channel.io가 클라이언트 렌더링이라 읽지 못함)
 *   TODO(verify-api): 외부 문의로 userChat을 만들고 고객 메시지로 첫 메시지를 넣는 엔드포인트(문서에서 찾지 못함.
 *     그룹 메시지 전송 POST /groups/{groupId}/messages만 확인됨)
 *   TODO(verify-api): 그렇게 만든 상담에 ALF가 응답하는지 → docs/channeltalk/03-tasks.md 체크리스트
 *
 * 확인 전까지 live 구현은 호출하지 않고 실패한다. 쿠팡 브릿지는 기본 off라 운영에 영향이 없다.
 */
export const CHANNELTALK_OPEN_API_BASE = 'https://api.channel.io/open/v5';

export type ChannelTalkClient = ChatCreator;

export class LiveChannelTalkClient implements ChannelTalkClient {
  async createChatForExternalInquiry(): Promise<{ chatId: string }> {
    throw new ConfigError(
      '채널톡 Open API 상담 생성 엔드포인트가 확인되지 않았습니다(TODO(verify-api)). ENABLE_COUPANG_BRIDGE=false로 두세요.',
    );
  }
}
