import { z } from 'zod';
import { createRouter } from '../../app/hono';
import { requireSecret } from '../../app/security';
import { parseQuery } from '../../app/validation';
import { toMarkdown } from './markdown';

/**
 * GET /reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD[&format=md]
 * 관리자 시크릿(X-Admin-Secret)이 필요하다. ALF 시크릿과 따로 둔다.
 * 기간 기본값: 오늘(KST)을 포함한 최근 7일.
 */
export const reportRoutes = createRouter();

reportRoutes.use(
  '*',
  requireSecret(
    'ADMIN_SECRET',
    (c) => c.req.header('X-Admin-Secret'),
    (env) => env.ADMIN_SECRET,
  ),
);

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const querySchema = z
  .object({ from: day.optional(), to: day.optional(), format: z.enum(['json', 'md']).default('json') })
  .refine((q) => !q.from || !q.to || q.from <= q.to, 'from은 to보다 늦을 수 없습니다');

const kstDay = (d: Date) => new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

reportRoutes.get('/summary', async (c) => {
  const q = parseQuery(c, querySchema);
  const { now, reports } = c.var.container;
  const today = now();
  const period = {
    from: q.from ?? kstDay(new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000)),
    to: q.to ?? kstDay(today),
  };
  const report = await reports.summary(period);
  if (q.format === 'md') return c.text(toMarkdown(report), 200, { 'Content-Type': 'text/markdown; charset=utf-8' });
  return c.json({ ok: true, report });
});
