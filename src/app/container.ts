import { EngineClient } from '../adapters/engine-client';
import { EngineSalesChannel } from '../adapters/sales-channel/engine';
import { MockSalesChannel } from '../adapters/sales-channel/mock';
import type { InquirySource, SalesChannelAdapter } from '../adapters/sales-channel/types';
import { EngineSupplier } from '../adapters/supplier/engine';
import { MockSupplier } from '../adapters/supplier/mock';
import type { SupplierAdapter } from '../adapters/supplier/types';
import { createAlfTaskService, createTaskLogRepository } from '../modules/alf-tasks';
import { type ChannelTalkClient, LiveChannelTalkClient, MockChannelTalkClient } from '../modules/channeltalk';
import { createCoupangBridge, createInquiryRepository, createInquiryService } from '../modules/inquiries';
import { createOrderRepository, createOrderService } from '../modules/orders';
import { createReportService } from '../modules/reports';
import { createSyncService } from '../modules/sync';
import { createCursorStore } from './cursors';
import { type AppConfig, type Env, readConfig } from './env';
import { createLogger, type Logger } from './logger';

/**
 * env → 어댑터·서비스 조립. DI 라이브러리 대신 평범한 함수 하나로 둔다.
 * 어떤 구현을 쓸지는 여기서만 결정하고, 모듈은 인터페이스만 안다.
 * 요청마다 새로 만든다(Workers 인스턴스 간 상태 공유를 기대하지 않기 위해). 만드는 비용은 객체 몇 개뿐이다.
 */

export interface Adapters {
  sales: SalesChannelAdapter;
  supplier: SupplierAdapter;
  /** 쿠팡 문의 브릿지가 읽는 쿠팡 문의 */
  coupangInquiries: InquirySource;
  channelTalk: ChannelTalkClient;
}

export function createAdapters(config: AppConfig, now: () => Date): Adapters {
  if (config.dataSource === 'live') {
    const client = new EngineClient(config.engineBaseUrl, config.engineToken);
    const sales = new EngineSalesChannel(client);
    return {
      sales,
      supplier: new EngineSupplier(client),
      coupangInquiries: sales,
      channelTalk: new LiveChannelTalkClient(),
    };
  }
  const sales = new MockSalesChannel(now);
  return { sales, supplier: new MockSupplier(now), coupangInquiries: sales, channelTalk: new MockChannelTalkClient() };
}

export interface ContainerOptions {
  now?: () => Date;
  logger?: Logger;
  adapters?: Adapters;
}

export function createContainer(env: Env, opts: ContainerOptions = {}) {
  const config = readConfig(env);
  const now = opts.now ?? (() => new Date());
  const log = opts.logger ?? createLogger({ service: 'cs-hub', dataSource: config.dataSource });
  const adapters = opts.adapters ?? createAdapters(config, now);
  const cursors = createCursorStore(env.DB);

  const orderRepo = createOrderRepository(env.DB);
  const orders = createOrderService({ repo: orderRepo, now });

  const inquiryRepo = createInquiryRepository(env.DB);
  const coupangBridge = createCoupangBridge({
    enabled: config.coupangBridgeEnabled,
    source: adapters.coupangInquiries,
    chats: adapters.channelTalk,
    repo: inquiryRepo,
    cursors,
    now,
    log,
  });
  const inquiries = createInquiryService({ repo: inquiryRepo, log, replyListener: coupangBridge.replyListener });

  const alfTasks = createAlfTaskService({
    orders,
    taskLogs: createTaskLogRepository(env.DB),
    now,
    log,
    outcomeListener: inquiries,
  });

  const sync = createSyncService({
    sales: adapters.sales,
    supplier: adapters.supplier,
    orders: orderRepo,
    cursors,
    now,
    log,
  });

  return {
    env,
    config,
    now,
    log,
    adapters,
    orderRepo,
    orders,
    alfTasks,
    inquiries,
    coupangBridge,
    reports: createReportService(env.DB),
    sync,
  };
}

export type Container = ReturnType<typeof createContainer>;
