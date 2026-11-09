import { applyD1Migrations, env } from 'cloudflare:test';

// 각 테스트 파일 시작 전에 마이그레이션 적용(이미 적용된 것은 건너뜀)
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
