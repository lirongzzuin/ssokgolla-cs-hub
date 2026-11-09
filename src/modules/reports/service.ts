/**
 * 운영 지표 집계. 읽기 전용이라 여러 모듈의 테이블을 SQL로 직접 모아 읽는다(쓰기는 각 모듈만 한다).
 *
 * 지표 정의
 *  - ALF 단독 해결: 상담원이 들어오지 않았고(handled_by=alf) 이관되지 않은(escalated=0) 상담
 *  - 이관: escalated=1 (태스크 ESCALATE 또는 상담원 참여)
 *  - 상품별 문의: 태스크가 주문을 찾은 상담·호출을 그 주문의 상품으로 묶는다
 *    → 문의가 많은 상품을 찾아 상품 선정에 반영하려는 목적
 */

export interface ReportPeriod {
  /** KST 날짜 YYYY-MM-DD (포함) */
  from: string;
  /** KST 날짜 YYYY-MM-DD (포함) */
  to: string;
}

export interface SummaryReport {
  period: ReportPeriod;
  inquiries: {
    total: number;
    resolvedByAlf: number;
    escalated: number;
    handledByAgent: number;
    alfResolutionRate: number | null;
    escalationRate: number | null;
    bySource: Array<{ source: string; count: number }>;
    escalationReasons: Array<{ reason: string; count: number }>;
  };
  tasks: Array<{ task: string; total: number; avgLatencyMs: number; decisions: Record<string, number> }>;
  products: Array<{ productName: string; inquiries: number; taskCalls: number; returnRequests: number }>;
}

/** KST 날짜 경계를 UTC ISO로. to는 다음 날 0시(미포함)로 바꿔 그날 전체를 포함한다. */
export function toUtcRange(period: ReportPeriod): [string, string] {
  const start = new Date(`${period.from}T00:00:00+09:00`);
  const end = new Date(new Date(`${period.to}T00:00:00+09:00`).getTime() + 24 * 60 * 60 * 1000);
  return [start.toISOString(), end.toISOString()];
}

const rate = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 1000) / 10);

export function createReportService(db: D1Database) {
  const all = async <T>(sql: string, from: string, to: string) =>
    (await db.prepare(sql).bind(from, to).all<T>()).results;

  return {
    async summary(period: ReportPeriod): Promise<SummaryReport> {
      const [from, to] = toUtcRange(period);
      const IN_RANGE = 'created_at >= ?1 AND created_at < ?2';

      const [totals, bySource, reasons, taskRows, productInquiries, productTasks] = await Promise.all([
        db
          .prepare(
            `SELECT COUNT(*) AS total,
               COALESCE(SUM(handled_by = 'alf' AND escalated = 0), 0) AS resolved_by_alf,
               COALESCE(SUM(escalated), 0) AS escalated,
               COALESCE(SUM(handled_by = 'agent'), 0) AS handled_by_agent
             FROM inquiries WHERE ${IN_RANGE}`,
          )
          .bind(from, to)
          .first<{ total: number; resolved_by_alf: number; escalated: number; handled_by_agent: number }>(),
        all<{ source: string; count: number }>(
          `SELECT source, COUNT(*) AS count FROM inquiries WHERE ${IN_RANGE} GROUP BY source ORDER BY count DESC`,
          from,
          to,
        ),
        all<{ reason: string; count: number }>(
          `SELECT COALESCE(escalation_reason, 'UNKNOWN') AS reason, COUNT(*) AS count
           FROM inquiries WHERE escalated = 1 AND ${IN_RANGE} GROUP BY reason ORDER BY count DESC`,
          from,
          to,
        ),
        all<{ task_name: string; decision: string; count: number; latency: number }>(
          `SELECT task_name, decision, COUNT(*) AS count, SUM(latency_ms) AS latency
           FROM task_logs WHERE ${IN_RANGE} GROUP BY task_name, decision`,
          from,
          to,
        ),
        all<{ product_name: string; count: number }>(
          `SELECT so.product_name, COUNT(*) AS count FROM inquiries i
           JOIN sales_orders so ON so.id = i.sales_order_id
           WHERE i.created_at >= ?1 AND i.created_at < ?2 GROUP BY so.product_name`,
          from,
          to,
        ),
        all<{ product_name: string; calls: number; returns: number }>(
          `SELECT so.product_name, COUNT(*) AS calls,
             SUM(t.task_name = 'order_return_request' AND t.decision IN ('ALLOW', 'ESCALATE')) AS returns
           FROM task_logs t JOIN sales_orders so ON so.id = t.sales_order_id
           WHERE t.created_at >= ?1 AND t.created_at < ?2 GROUP BY so.product_name`,
          from,
          to,
        ),
      ]);

      const t = totals ?? { total: 0, resolved_by_alf: 0, escalated: 0, handled_by_agent: 0 };
      return {
        period,
        inquiries: {
          total: t.total,
          resolvedByAlf: t.resolved_by_alf,
          escalated: t.escalated,
          handledByAgent: t.handled_by_agent,
          alfResolutionRate: rate(t.resolved_by_alf, t.total),
          escalationRate: rate(t.escalated, t.total),
          bySource,
          escalationReasons: reasons,
        },
        tasks: groupTasks(taskRows),
        products: mergeProducts(productInquiries, productTasks),
      };
    },
  };
}

function groupTasks(rows: Array<{ task_name: string; decision: string; count: number; latency: number }>) {
  const byTask = new Map<string, { total: number; latency: number; decisions: Record<string, number> }>();
  for (const r of rows) {
    const t = byTask.get(r.task_name) ?? { total: 0, latency: 0, decisions: {} };
    t.total += r.count;
    t.latency += r.latency;
    t.decisions[r.decision] = r.count;
    byTask.set(r.task_name, t);
  }
  return [...byTask.entries()]
    .map(([task, t]) => ({
      task,
      total: t.total,
      avgLatencyMs: Math.round(t.latency / t.total),
      decisions: t.decisions,
    }))
    .sort((a, b) => b.total - a.total);
}

function mergeProducts(
  inquiries: Array<{ product_name: string; count: number }>,
  tasks: Array<{ product_name: string; calls: number; returns: number }>,
) {
  const map = new Map<string, { productName: string; inquiries: number; taskCalls: number; returnRequests: number }>();
  const get = (name: string) => {
    const existing = map.get(name);
    if (existing) return existing;
    const created = { productName: name, inquiries: 0, taskCalls: 0, returnRequests: 0 };
    map.set(name, created);
    return created;
  };
  for (const r of inquiries) get(r.product_name).inquiries = r.count;
  for (const r of tasks) {
    const p = get(r.product_name);
    p.taskCalls = r.calls;
    p.returnRequests = r.returns ?? 0;
  }
  return [...map.values()].sort(
    (a, b) => b.inquiries + b.taskCalls - (a.inquiries + a.taskCalls) || b.returnRequests - a.returnRequests,
  );
}

export type ReportService = ReturnType<typeof createReportService>;
