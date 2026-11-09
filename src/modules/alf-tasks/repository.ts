import type { Decision } from '../orders';

export interface TaskLogInput {
  taskName: string;
  salesOrderId: number | null;
  chatId: string | null;
  decision: Decision;
  reasonCode: string;
  latencyMs: number;
  createdAt: Date;
}

/** task_logs 기록. 리포트(태스크별 decision 분포, 이관 사유)의 원천이다. */
export function createTaskLogRepository(db: D1Database) {
  return {
    async insert(log: TaskLogInput): Promise<void> {
      await db
        .prepare(
          `INSERT INTO task_logs (task_name, sales_order_id, chat_id, decision, reason_code, latency_ms, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
        )
        .bind(
          log.taskName,
          log.salesOrderId,
          log.chatId,
          log.decision,
          log.reasonCode,
          log.latencyMs,
          log.createdAt.toISOString(),
        )
        .run();
    },
  };
}

export type TaskLogRepository = ReturnType<typeof createTaskLogRepository>;
