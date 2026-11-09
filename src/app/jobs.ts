import type { Container } from './container';

/**
 * cron 작업 목록(wrangler.jsonc triggers, 10분마다). 작업을 추가하면 여기에 한 줄.
 * 작업 하나가 실패해도 나머지는 돈다. 실패는 로그로 남기고 다음 실행에서 커서부터 다시 한다.
 */
export async function runScheduledJobs(c: Container): Promise<void> {
  const jobs: Array<[string, () => Promise<unknown>]> = [
    ['order_sync', () => c.sync.runOrderSync()],
    ['coupang_bridge', () => c.coupangBridge.run()],
  ];
  for (const [name, run] of jobs) {
    try {
      await run();
    } catch (err) {
      c.log.error('scheduled_job_failed', { job: name, message: err instanceof Error ? err.message : String(err) });
    }
  }
}
