import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// 테스트는 실제 Workers 런타임(Miniflare)에서 돈다. D1도 테스트마다 격리된 로컬 DB를 쓴다.
export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations('./migrations'),
          ALF_SECRET: 'test-alf-secret',
          ADMIN_SECRET: 'test-admin-secret',
          CHANNELTALK_WEBHOOK_TOKEN: 'test-webhook-token',
        },
      },
    })),
  ],
  test: {
    setupFiles: ['./tests/setup.ts'],
  },
});
