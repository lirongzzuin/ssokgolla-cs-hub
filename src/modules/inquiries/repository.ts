export type InquirySource = 'channeltalk' | 'coupang' | 'smartstore';

/**
 * inquiries(상담 1건 = 1행)와 coupang_bridge_links 접근.
 * 같은 상담에 이벤트가 여러 번 오므로 모든 쓰기는 upsert(멱등)다.
 */
export function createInquiryRepository(db: D1Database) {
  return {
    async exists(source: InquirySource, externalId: string): Promise<boolean> {
      const row = await db
        .prepare('SELECT 1 AS found FROM inquiries WHERE source = ?1 AND external_id = ?2')
        .bind(source, externalId)
        .first();
      return row !== null;
    },

    /** 처음 보는 상담이면 만든다. 이미 있으면 그대로 둔다. */
    async ensure(source: InquirySource, externalId: string, createdAt: Date, category = 'UNKNOWN'): Promise<void> {
      await db
        .prepare(
          `INSERT INTO inquiries (source, external_id, category, created_at) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT (source, external_id) DO NOTHING`,
        )
        .bind(source, externalId, category, createdAt.toISOString())
        .run();
    },

    /**
     * 상담원이 상담에 들어왔다 → 상담원 처리 + 이관.
     * 이관 사유는 태스크가 먼저 남긴 값(예: SUPPLIER_ALREADY_ORDERED)을 덮어쓰지 않는다.
     */
    async markAgentJoined(source: InquirySource, externalId: string): Promise<void> {
      await db
        .prepare(
          `UPDATE inquiries SET handled_by = 'agent', escalated = 1,
             escalation_reason = COALESCE(escalation_reason, 'AGENT_JOINED')
           WHERE source = ?1 AND external_id = ?2`,
        )
        .bind(source, externalId)
        .run();
    },

    /** 태스크 결과 반영: 주문 연결, 문의 분류, ESCALATE면 이관 사유 */
    async applyTaskOutcome(input: {
      chatId: string;
      salesOrderId: number | null;
      category: string;
      escalationReason: string | null;
    }): Promise<void> {
      await db
        .prepare(
          `UPDATE inquiries SET
             sales_order_id = COALESCE(?2, sales_order_id),
             category = CASE WHEN category = 'UNKNOWN' THEN ?3 ELSE category END,
             escalated = CASE WHEN ?4 IS NULL THEN escalated ELSE 1 END,
             escalation_reason = COALESCE(?4, escalation_reason)
           WHERE source = 'channeltalk' AND external_id = ?1`,
        )
        .bind(input.chatId, input.salesOrderId, input.category, input.escalationReason)
        .run();
    },

    async markEscalated(source: InquirySource, externalId: string, reason: string): Promise<void> {
      await db
        .prepare(
          `UPDATE inquiries SET handled_by = 'agent', escalated = 1, escalation_reason = ?3
           WHERE source = ?1 AND external_id = ?2`,
        )
        .bind(source, externalId, reason)
        .run();
    },

    // ── 쿠팡 브릿지 연결 ──

    async findBridgeLinkByInquiry(inquiryId: string) {
      return db
        .prepare(
          'SELECT inquiry_id, inquiry_kind, chat_id, answered_at FROM coupang_bridge_links WHERE inquiry_id = ?1',
        )
        .bind(inquiryId)
        .first<BridgeLinkRow>();
    },

    async findBridgeLinkByChat(chatId: string) {
      return db
        .prepare('SELECT inquiry_id, inquiry_kind, chat_id, answered_at FROM coupang_bridge_links WHERE chat_id = ?1')
        .bind(chatId)
        .first<BridgeLinkRow>();
    },

    async insertBridgeLink(link: { inquiryId: string; kind: 'product' | 'callcenter'; chatId: string; at: Date }) {
      await db
        .prepare(
          `INSERT INTO coupang_bridge_links (inquiry_id, inquiry_kind, chat_id, created_at) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT (inquiry_id) DO NOTHING`,
        )
        .bind(link.inquiryId, link.kind, link.chatId, link.at.toISOString())
        .run();
    },

    /** 답변 등록 표시. 이미 답변했으면 false(중복 답변 방지) */
    async markBridgeAnswered(inquiryId: string, at: Date): Promise<boolean> {
      const res = await db
        .prepare('UPDATE coupang_bridge_links SET answered_at = ?2 WHERE inquiry_id = ?1 AND answered_at IS NULL')
        .bind(inquiryId, at.toISOString())
        .run();
      return res.meta.changes > 0;
    },

    /** 쿠팡 답변 등록이 실패하면 표시를 되돌려 다음 답변 때 다시 시도하게 한다 */
    async clearBridgeAnswered(inquiryId: string): Promise<void> {
      await db
        .prepare('UPDATE coupang_bridge_links SET answered_at = NULL WHERE inquiry_id = ?1')
        .bind(inquiryId)
        .run();
    },
  };
}

export interface BridgeLinkRow {
  inquiry_id: string;
  inquiry_kind: 'product' | 'callcenter';
  chat_id: string;
  answered_at: string | null;
}

export type InquiryRepository = ReturnType<typeof createInquiryRepository>;
