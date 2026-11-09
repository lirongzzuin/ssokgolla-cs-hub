// inquiries 모듈의 공개 API
export { type BridgeRunResult, type ChatCreator, type CoupangBridge, createCoupangBridge } from './coupang-bridge';
export { createInquiryRepository, type InquiryRepository } from './repository';
export { type ChatEvent, type ChatMessageListener, createInquiryService, type InquiryService } from './service';
