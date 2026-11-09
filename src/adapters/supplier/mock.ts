import { buildMockOrders } from '../mock-fixtures';
import type { SupplierAdapter, SupplierOrderSnapshot } from './types';

/**
 * mock 공급처. 공급처는 mock만 구현한다(실제 공급처 크롤링·자동 발주는 범위 밖).
 * live에서는 dropship-engine이 공급처 발주·송장을 알려준다(./engine.ts).
 */
export class MockSupplier implements SupplierAdapter {
  readonly name = 'mock';

  constructor(private readonly now: () => Date) {}

  async listChangedSupplierOrders(since: Date | null): Promise<SupplierOrderSnapshot[]> {
    const all = buildMockOrders(this.now()).flatMap((f) => (f.supplier ? [f.supplier] : []));
    return since ? all.filter((s) => s.updatedAt > since) : all;
  }
}
