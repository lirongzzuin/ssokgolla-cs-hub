/**
 * 증분 작업 커서(sync_state). "마지막으로 어디까지 가져왔나"를 이름별로 저장한다.
 * 주문 동기화(orders)와 쿠팡 문의 브릿지(coupang_bridge)가 쓴다.
 */
export function createCursorStore(db: D1Database) {
  return {
    async get(name: string): Promise<Date | null> {
      const row = await db
        .prepare('SELECT cursor FROM sync_state WHERE name = ?1')
        .bind(name)
        .first<{ cursor: string }>();
      return row ? new Date(row.cursor) : null;
    },
    async set(name: string, cursor: Date, now: Date): Promise<void> {
      await db
        .prepare(
          `INSERT INTO sync_state (name, cursor, updated_at) VALUES (?1, ?2, ?3)
           ON CONFLICT (name) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at`,
        )
        .bind(name, cursor.toISOString(), now.toISOString())
        .run();
    },
  };
}

export type CursorStore = ReturnType<typeof createCursorStore>;
