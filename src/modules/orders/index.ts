// orders 모듈의 공개 API. 다른 모듈은 이 파일에서만 import한다.
export { buildCustomerMessage, channelLabel, ESCALATE_SUFFIX, ORDER_NOT_FOUND_MESSAGE } from './messages';
export { decide, type PolicyContext, type PolicyInput, RULES } from './policy';
export { defaultPolicyConfig, type PolicyConfig } from './policy.config';
export {
  createOrderRepository,
  type OrderRepository,
  type SalesOrderInput,
  type ShipmentInput,
  type SupplierOrderInput,
} from './repository';
export {
  type CustomerOrderQuery,
  createOrderService,
  type Evaluation,
  type OrderService,
  type PublicOrder,
  toPublicOrder,
} from './service';
export { deriveStatus, STATUS_LABEL } from './status';
export * from './types';
