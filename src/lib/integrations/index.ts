// Integration Engine — public surface.
//
// The Core imports from here and nowhere deeper. Connector implementations are
// deliberately absent: they belong to Edge Functions, server-side, where the
// credential is resolved — never in the browser bundle.

// ── Domain models ───────────────────────────────────────────────────────────
export type {
  ConnectionStatus,
  EntityLink,
  EntityType,
  IntegrationConnection,
  IntegrationProvider,
  MatchSource,
  NormalizedLocation,
  NormalizedOrder,
  NormalizedOrderItem,
  NormalizedProduct,
  NormalizedRef,
  NormalizedStockLevel,
  NormalizedWarehouse,
  ProviderCapabilities,
  ProviderKind,
  ProviderStatus,
  SyncCounters,
  SyncDirection,
  SyncEntity,
  SyncFlow,
  SyncItemError,
  SyncResult,
  SyncRun,
  SyncStatus,
  SyncTrigger,
} from './types';

// ── Capabilities ────────────────────────────────────────────────────────────
export {
  Capability,
  OPERATION_CAPABILITY,
  checkOperation,
  declaredCapabilities,
  hasCapability,
  isWriteOperation,
} from './capabilities';
export type { CapabilityKey, OperationGate, OperationName } from './capabilities';

// ── Errors ──────────────────────────────────────────────────────────────────
export {
  IntegrationError,
  describeError,
  errorFromHttp,
  isIntegrationError,
  kindFromHttpStatus,
  parseRetryAfter,
  toIntegrationError,
} from './errors';
export type { IntegrationErrorInit, IntegrationErrorKind } from './errors';

// ── Result object ───────────────────────────────────────────────────────────
export { fail, isOk, ok, shouldThrottle, throttleDelayMs, unwrap } from './result';
export type {
  OperationFailure,
  OperationResult,
  OperationSuccess,
  RateLimitInfo,
  ResultMeta,
} from './result';

// ── Pagination ──────────────────────────────────────────────────────────────
export {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGES_PER_RUN,
  MAX_PAGE_LIMIT,
  clampLimit,
  firstPage,
  isRunawayWalk,
  nextPageRequest,
} from './pagination';
export type { PageInfo, PageRequest, PageStrategy } from './pagination';

// ── Retry ───────────────────────────────────────────────────────────────────
export {
  DEFAULT_RETRY_POLICY,
  RATE_LIMIT_RETRY_POLICY,
  decideRetry,
  policyFor,
  worstCaseTotalDelayMs,
} from './retry';
export type { RetryDecision, RetryPolicy } from './retry';

// ── Stock operations ────────────────────────────────────────────────────────
export {
  buildCountAdjustment,
  isNoOpWrite,
  netEffect,
  preferredWriteKind,
} from './stockOperations';
export type {
  AbsoluteStockWrite,
  DeltaStockWrite,
  MovementStockWrite,
  StockReadKind,
  StockWrite,
  StockWriteKind,
  TransferStockWrite,
} from './stockOperations';

// ── Connector contract ──────────────────────────────────────────────────────
export { implementsOperation, summariseErrors, supportsFlow } from './connector';
export type {
  AuthResult,
  ConnectionTestResult,
  Connector,
  ConnectorContext,
  ListRequest,
  RawRecord,
  WebhookRegistration,
  WriteAck,
} from './connector';

// ── Adapter ─────────────────────────────────────────────────────────────────
export { ProviderAdapter, connectorFail, connectorOk } from './adapter';
export type { AdapterOptions, AttemptEvent } from './adapter';

// ── Normalizers ─────────────────────────────────────────────────────────────
export {
  asRecord,
  normalizeBatch,
  normalizeLocation,
  normalizeOrder,
  normalizeProduct,
  normalizeStockLevel,
  normalizeWarehouse,
  readBoolean,
  readIsoDate,
  readNumber,
  readString,
} from './normalizers';
export type {
  LocationFieldMap,
  NormalizeOutcome,
  OrderFieldMap,
  ProductFieldMap,
  StockFieldMap,
} from './normalizers';

// ── Matching primitives ─────────────────────────────────────────────────────
export {
  buildStockWriteKey,
  hasMeaningfulChange,
  normalizeEan,
  normalizeSku,
  resolveMatch,
} from './matching';
export type { MatchCandidate, MatchOutcome } from './matching';

// ── Mapping engine ──────────────────────────────────────────────────────────
export {
  buildReverseIndex,
  countAmbiguousReverse,
  linkManually,
  loadLinkIndex,
  resolve,
  toInternalId,
  unlink,
  upsertLinks,
} from './mappingEngine';
export type { Resolution, ResolutionInput, UpsertLinkInput } from './mappingEngine';

// ── Connection tester ───────────────────────────────────────────────────────
export {
  describeCapabilities,
  requiredCapabilitiesFor,
  runConnectionTest,
} from './connectionTester';
export type { ConnectionTestOutcome, TestOutcomeStatus } from './connectionTester';

// ── Connection/provider service (Supabase-facing) ───────────────────────────
export {
  buildCredentialHint,
  clearConnectionCredential,
  countUnlinked,
  createConnection,
  deleteConnection,
  listConnections,
  listEntityLinks,
  listProviders,
  listSyncRuns,
  setConnectionCredential,
  updateConnection,
} from './integrationService';
export type { CreateConnectionInput, UpdateConnectionInput } from './integrationService';

// ── Sync Engine (Fase 3) ────────────────────────────────────────────────────
export { SyncEngine } from './sync/syncEngine';
export type {
  CreateJobInput,
  InboundStockUpdate,
  JobPatch,
  RecordItemInput,
  StockLevelSnapshot,
  SyncEngineOptions,
  SyncOutcome,
  SyncRepository,
  UpsertConflictInput,
} from './sync/syncEngine';

export { createSupabaseSyncRepository } from './sync/supabaseSyncRepository';

export {
  describeOutcome,
  isImplausibleDivergence,
  quantitiesAgree,
  requiresReview,
  resolutionFor,
  resolveStockConflict,
} from './sync/conflictResolution';
export type { ConflictOutcome, ConflictReason, ResolveInput } from './sync/conflictResolution';

export { planCountAdjustments, planCounters, planStockSync } from './sync/stockSyncPlanner';
export type {
  PlanOptions,
  PlannedConflict,
  PlannedInboundUpdate,
  PlannedOutboundWrite,
  PlannedSkip,
  StockPair,
  StockSyncPlan,
} from './sync/stockSyncPlanner';

export { aggregateStockByProduct, hasMultiWarehouseProducts } from './sync/stockAggregation';
export type { AggregatedStock, WarehouseBreakdown } from './sync/stockAggregation';

export {
  EMPTY_INCREMENTAL_STATE,
  ITEM_OPERATION_FOR_WRITE,
  incrementalStateFor,
} from './sync/syncTypes';
export type {
  AdjustmentOrigin,
  AdjustmentSyncStatus,
  ConflictPolicy,
  ConflictStatus,
  IncrementalState,
  StockAdjustment,
  StockObservation,
  SyncConflict,
  SyncConnectionConfig,
  SyncItem,
  SyncItemOperation,
  SyncItemStatus,
  SyncJob,
  SyncJobStatus,
  SyncJobType,
} from './sync/syncTypes';

// ── Outbound write guard — the last check before a provider balance changes ──
export {
  DEFAULT_WRITE_LIMITS,
  MOVEMENT_DIRECTION,
  MOVEMENT_REASON_LABEL,
  buildFullWithdrawalTransfer,
  buildReturnWrite,
  buildWithdrawalWrite,
  describeRejection,
  guardBatch,
  guardStockWrite,
  isOverridable,
  projectedBalance,
} from './sync/stockWriteGuard';
export type {
  GuardInput,
  GuardRejection,
  GuardVerdict,
  MovementReason,
  WriteGuardLimits,
} from './sync/stockWriteGuard';

// ── Tiny ERP (Olist) protocol — pure, no network ────────────────────────────
export {
  TINY_API_BASE,
  TINY_CAPABILITIES,
  TINY_ENDPOINTS,
  TINY_PRODUCT_FIELD_MAP,
  TINY_STOCK_FIELD_MAP,
  buildTinyStockPayload,
  buildTinyTransferLegs,
  extractTinyErrorMessage,
  extractTinyStockRows,
  parseTinyResponse,
  prepareTinyProduct,
  tinyMovementType,
  tinyPageInfo,
  unwrapTinyList,
} from './providers/tiny/tinyProtocol';
export type { TinyEnvelope, TinyParsed, TinyStockPayload } from './providers/tiny/tinyProtocol';

// ── Deposit mapping — names are configuration, roles are the engine's ───────
export {
  EMPTY_DEPOSIT_CONFIG,
  depositIsCountable,
  depositKey,
  describeDepositConfigError,
  describeFullWithdrawalFailure,
  findDeposit,
  fulfillmentDeposits,
  generalDeposit,
  isDepositConfigUsable,
  resolveFullWithdrawal,
  suggestDepositRole,
  unmappedDeposits,
  validateDepositConfig,
} from './sync/depositMapping';
export type {
  DepositConfig,
  DepositConfigError,
  DepositMapping,
  DepositRole,
  FullWithdrawalTarget,
} from './sync/depositMapping';

// ── Authorization — pure decisions shared by the Edge Functions ─────────────
export {
  SYNC_ROLES,
  authorizeCaller,
  authorizeConnection,
  authorizeCredential,
  parseSyncRequest,
} from './authorization';
export type {
  AuthorizationDenial,
  CallerFacts,
  ConnectionFacts,
  CredentialFacts,
  ParsedSyncRequest,
  SyncRequestDirection,
} from './authorization';
