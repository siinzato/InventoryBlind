import { createClient } from '@supabase/supabase-js';
import type {
  BrandData, RcaSourceModule, RcaCauseCategory, RcaFiveWhysTriggerType, RcaFiveWhysStatus, RcaRecord,
  AbcClass, XyzClass, AbcXyzCombo, BlindAIPriority, BlindAILineRanking,
} from './domainTypes';

// Tipos de domínio puros (BrandData, tipos de RCA/ABC-XYZ/BlindAI) vivem em domainTypes.ts
// — importados aqui (para uso nas interfaces abaixo) e reexportados (para que nenhum
// import existente em outros arquivos precise mudar).
export type {
  BrandData, RcaSourceModule, RcaCauseCategory, RcaFiveWhysTriggerType, RcaFiveWhysStatus, RcaRecord,
  AbcClass, XyzClass, AbcXyzCombo, BlindAIPriority, BlindAILineRanking,
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Types

export interface TopVenda {
  id: string;
  produto: string;
  sku: string;
  vendas: string;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface CustomKPI {
  id: string;
  titulo: string;
  valor: string;
  unidade: string;
  variacao: string;
  tipo_variacao: 'up' | 'down' | 'neutral';
  cor_icone: 'blue' | 'red' | 'amber' | 'emerald';
  order_index: number;
  created_at: string;
  updated_at: string;
}

// History Types
export interface InventorySnapshot {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  total_sku: number;
  total_done: number;
  total_divergences: number;
  progress: number;
  accuracy: number;
  status: 'completed' | 'in_progress';
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface InventoryBrandHistory {
  id: string;
  snapshot_id: string;
  brand: string;
  total_sku: number;
  done_sku: number;
  divergences: number;
  progress: number;
  accuracy: number | null;
  status: string;
  created_at: string;
}

export interface InventoryKpiHistory {
  id: string;
  snapshot_id: string;
  titulo: string;
  valor: string;
  unidade: string;
  variacao: string;
  tipo_variacao: string;
  cor_icone: string;
  created_at: string;
}

export interface InventoryTopVendasHistory {
  id: string;
  snapshot_id: string;
  produto: string;
  sku: string;
  vendas: string;
  order_index: number;
  created_at: string;
}

// Count Management Types
export interface InventoryCountRecord {
  id: string;
  company_id: string;
  brand_id: string;
  count_number: 1 | 2 | 3;
  source: 'manual' | 'import';
  linked_count_id: string | null;
  operator_1: string | null;
  operator_2: string | null;
  total_sku: number;
  skus_contados: number;
  divergencias_encontradas: number;
  divergencias_recontadas: number;
  divergencias_reais: number;
  valor_financeiro_divergencias: number | null;
  accuracy_initial: number | null;
  accuracy_final: number | null;
  observacoes: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_seconds: number | null;
  created_by: string | null;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
}

export interface InventoryCountImportItem {
  id: string;
  count_record_id: string;
  company_id: string;
  product_id: string | null;
  sku: string | null;
  ean: string | null;
  produto_nome: string | null;
  local: string | null;
  saldo_sistema: number | null;
  saldo_contado: number | null;
  diferenca: number | null;
  status: 'correct' | 'divergent' | 'missing' | 'surplus' | null;
  responsavel: string | null;
  created_at: string;
}

// Productivity Types
export interface UserProductivityStats {
  user_id: string;
  company_id: string;
  name: string | null;
  role: string;
  skus_contados: number;
  contagens: number;
  recontagens: number;
  divergencias_encontradas: number;
  divergencias_reais: number;
  acuracidade_media: number | null;
  tempo_medio_segundos: number | null;
  fulls_realizados: number;
  itens_separados: number;
  etiquetas_geradas: number;
  ultima_atividade: string | null;
}

export type AchievementLevel = 'bronze' | 'prata' | 'ouro' | 'diamante';

export interface AchievementDefinition {
  id: string;
  key: string;
  category: string;
  level: AchievementLevel;
  title: string;
  description: string;
  goal_metric: string;
  goal_value: number;
  icon: string;
  order_index: number;
  created_at: string;
}

export interface UserAchievement {
  id: string;
  user_id: string;
  company_id: string;
  achievement_definition_id: string;
  progress_value: number;
  unlocked: boolean;
  unlocked_at: string | null;
  updated_at: string;
}

export type IncentiveType =
  | 'parabens' | 'agradecimento' | 'meta_atingida' | 'destaque'
  | 'evolucao' | 'precisao' | 'full_manager' | 'inventario' | 'personalizado';

export interface EmployeeIncentive {
  id: string;
  company_id: string;
  employee_user_id: string;
  sent_by: string | null;
  type: IncentiveType;
  subject: string;
  message: string;
  reward_suggestion: string | null;
  cc_manager: boolean;
  status: 'simulated' | 'sent' | 'failed';
  created_at: string;
}

// I.B Academy Types
export interface AcademyTrack {
  id: string;
  key: string;
  title: string;
  description: string;
  icon: string;
  order_index: number;
  created_at: string;
}

export interface AcademyCourse {
  id: string;
  track_id: string;
  key: string;
  title: string;
  objectives: string;
  workload_hours: number;
  order_index: number;
  is_placeholder: boolean;
  pilar_tag: string | null;
  created_at: string;
}

export interface AcademyLessonAttachment {
  name: string;
  url: string;
  type: 'pdf' | 'image';
}

export interface AcademyLesson {
  id: string;
  course_id: string;
  title: string;
  body_richtext: string;
  video_url: string | null;
  attachments: AcademyLessonAttachment[];
  order_index: number;
  created_at: string;
}

export interface AcademyQuiz {
  id: string;
  course_id: string;
  min_pass_pct: number;
  created_at: string;
}

export interface AcademyQuizQuestion {
  id: string;
  quiz_id: string;
  question: string;
  options: string[];
  correct_index: number;
  order_index: number;
}

export interface AcademyEnrollment {
  id: string;
  company_id: string;
  user_id: string;
  track_id: string;
  started_at: string;
  completed_at: string | null;
}

export type AcademyCourseStatus = 'not_started' | 'in_progress' | 'completed';

export interface AcademyCourseProgress {
  id: string;
  company_id: string;
  user_id: string;
  course_id: string;
  status: AcademyCourseStatus;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export interface AcademyLessonProgress {
  id: string;
  company_id: string;
  user_id: string;
  lesson_id: string;
  completed: boolean;
  completed_at: string | null;
}

export interface AcademyQuizAttempt {
  id: string;
  company_id: string;
  user_id: string;
  quiz_id: string;
  answers: number[];
  score_pct: number;
  passed: boolean;
  created_at: string;
}

export interface AcademyCertificate {
  id: string;
  company_id: string;
  user_id: string;
  track_id: string;
  learner_name: string;
  total_workload_hours: number;
  issued_at: string;
}

export interface PilarChecklistProgress {
  id: string;
  company_id: string;
  user_id: string;
  item_key: string;
  checked: boolean;
  updated_at: string;
}

export interface PdiPlan {
  id: string;
  company_id: string;
  employee_user_id: string;
  created_by: string | null;
  goal_title: string;
  goal_description: string | null;
  status: 'active' | 'completed' | 'archived';
  created_at: string;
}

export interface PdiStep {
  id: string;
  company_id: string;
  pdi_plan_id: string;
  title: string;
  course_id: string | null;
  order_index: number;
  completed: boolean;
  completed_at: string | null;
}

export interface LibraryResource {
  id: string;
  title: string;
  description: string | null;
  category: 'pdf' | 'checklist' | 'pop' | 'template' | 'ebook';
  external_url: string | null;
  is_placeholder: boolean;
  order_index: number;
  created_at: string;
  publisher: string | null;
  page_count: number | null;
  format: string | null;
  cover_url: string | null;
  themes: string[] | null;
  subject: string | null;
}

export interface AcademyTrackProgressRow {
  user_id: string;
  company_id: string;
  track_id: string;
  track_title: string;
  courses_total: number;
  courses_completed: number;
  pct_complete: number;
  hours_studied: number;
  has_certificate: boolean;
}

export interface AcademyTeamSummaryRow {
  user_id: string;
  company_id: string;
  name: string | null;
  role: string;
  courses_completed: number;
  certificates_count: number;
  hours_studied: number;
  last_activity_at: string | null;
  never_accessed: boolean;
}

// Confidence Based Counting (CBC) Types
export type RiskLevel = 'excelente' | 'bom' | 'medio' | 'critico';

export interface ConfidenceFactorBreakdown {
  score: number;
  weight: number;
  detail: string;
}

export interface ProductConfidenceScore {
  id: string;
  company_id: string;
  product_id: string;
  /** null quando has_sufficient_data é false — nunca um score fabricado. */
  confidence_score: number | null;
  risk_level: RiskLevel | null;
  next_count_date: string;
  factors: Record<string, ConfidenceFactorBreakdown>;
  top_reasons: string[];
  algorithm_version: string;
  last_algorithm_run: string;
  created_at: string;
  updated_at: string;
  has_sufficient_data: boolean;
  missing_factors: string[];
  /** Prioridade de contagem — conceito separado de confiança, própria fórmula. */
  priority_score: number | null;
  why_to_count: string | null;
  is_manually_scheduled: boolean;
  scheduled_by: string | null;
  scheduled_at: string | null;
}

export interface ProductConfidenceHistory {
  id: string;
  company_id: string;
  product_id: string;
  confidence_score: number;
  risk_level: RiskLevel;
  recorded_at: string;
}

export interface CBCCompanySummary {
  company_id: string;
  avg_confidence: number | null;
  total_scored: number;
  distinct_locations: number;
  excelente_count: number;
  bom_count: number;
  medio_count: number;
  critico_count: number;
  insufficient_count: number;
  overdue_count: number;
  due_this_week_count: number;
  scheduled_this_week_count: number;
}

// Inventário por Risco (Risk Score) Types — semantically opposite to CBC:
// high score = MORE risk here, high score = MORE confidence in CBC.
export type RiskBand = 'critico' | 'alto' | 'medio' | 'baixo';
export type CriticalityLevel = 'baixa' | 'normal' | 'alta' | 'maxima';

export interface ProductRiskScore {
  id: string;
  company_id: string;
  product_id: string;
  /** null quando has_sufficient_data é false — nunca um score fabricado. */
  risk_score: number | null;
  risk_level: RiskBand | null;
  /** Causa dominante (texto curto, ex. "Divergência recorrente"). */
  risk_reason: string;
  /** Probabilidade e impacto separados — Risk Score = Probabilidade × Impacto / 100. */
  probability: number | null;
  impact: number | null;
  factors: {
    probability: Record<string, ConfidenceFactorBreakdown & { max: number }>;
    impact: Record<string, ConfidenceFactorBreakdown & { max: number }>;
  };
  algorithm_version: string;
  last_risk_update: string;
  created_at: string;
  updated_at: string;
  has_sufficient_data: boolean;
  missing_factors: string[];
}

export interface ProductRiskHistory {
  id: string;
  company_id: string;
  product_id: string;
  risk_score: number;
  risk_level: RiskBand;
  recorded_at: string;
}

export interface ProductCriticalityOverride {
  id: string;
  company_id: string;
  product_id: string;
  criticality_level: CriticalityLevel;
  set_by: string | null;
  updated_at: string;
}

export interface RiskCompanySummary {
  company_id: string;
  avg_risk: number | null;
  total_scored: number;
  critico_count: number;
  alto_count: number;
  medio_count: number;
  baixo_count: number;
  insufficient_count: number;
}


export type AbcXyzUnclassifiedReason = 'sem_movimento' | 'sem_custo' | 'fonte_desconectada' | 'historico_insuficiente' | 'sku_nao_associado';
export type AbcXyzPeriod = '90d' | '6m' | '12m';

export interface ProductAbcXyzClassification {
  id: string;
  company_id: string;
  product_id: string;
  /** null quando unclassified_reason está preenchido — nunca uma classe fabricada. */
  abc_class: AbcClass | null;
  xyz_class: XyzClass | null;
  abc_xyz_class: AbcXyzCombo | null;
  classification_date: string;
  period: AbcXyzPeriod;
  source: string;
  value_moved: number;
  quantity_moved: number;
  unit_cost_used: number | null;
  demand_coefficient_variation: number | null;
  weeks_with_data: number;
  weeks_without_sale: number;
  unclassified_reason: AbcXyzUnclassifiedReason | null;
  reasons: string[];
  algorithm_version: string;
  created_at: string;
  updated_at: string;
}

export interface ProductAbcXyzHistory {
  id: string;
  company_id: string;
  product_id: string;
  abc_xyz_class: AbcXyzCombo;
  value_moved: number;
  period: AbcXyzPeriod;
  recorded_at: string;
}

// Slotting Intelligence Types
export type WarehouseCellType = 'rua' | 'modulo' | 'posicao' | 'expedicao' | 'vazio' | 'porta' | 'doca';
export type SlottingRecommendationType = 'mover_mais_perto' | 'aproximar_expedicao' | 'agrupar_frequentes' | 'redistribuir_fluxo';
export type SlottingRecommendationStatus = 'pendente' | 'aprovada' | 'rejeitada' | 'adiada';

export type WarehouseLayoutStatus = 'draft' | 'published' | 'archived';

export interface WarehouseLayout {
  id: string;
  company_id: string;
  name: string;
  grid_width: number;
  grid_height: number;
  cell_size_meters: number;
  is_active: boolean;
  background_image_path: string | null;
  background_offset_x: number;
  background_offset_y: number;
  background_scale: number;
  background_opacity: number;
  status: WarehouseLayoutStatus;
  version: number;
  published_at: string | null;
  scale_confirmed: boolean;
  created_at: string;
  updated_at: string;
}

export type WarehouseZoneKind = 'zona' | 'area' | 'obstaculo';

export interface WarehouseZone {
  id: string;
  layout_id: string;
  company_id: string;
  code: string;
  name: string;
  kind: WarehouseZoneKind;
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
  created_at: string;
  updated_at: string;
}

export interface WarehouseCell {
  id: string;
  layout_id: string;
  company_id: string;
  x: number;
  y: number;
  cell_type: WarehouseCellType;
  location_code: string | null;
  capacity: number | null;
}

export interface WarehouseSlottingRecommendation {
  id: string;
  company_id: string;
  layout_id: string;
  product_id: string | null;
  recommendation_type: SlottingRecommendationType;
  current_location: string | null;
  suggested_location: string | null;
  estimated_meters_saved: number;
  estimated_time_saved_seconds: number;
  estimated_productivity_gain_pct: number;
  status: SlottingRecommendationStatus;
  reason: string;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
}

export interface WarehouseOptimizationHistoryEntry {
  id: string;
  company_id: string;
  layout_id: string;
  recommendation_id: string | null;
  event: string;
  meters_saved: number;
  recorded_at: string;
}

export interface RcaEvidence {
  id: string;
  rca_record_id: string;
  company_id: string;
  file_path: string;
  file_name: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface RcaFiveWhysSession {
  id: string;
  company_id: string;
  trigger_type: RcaFiveWhysTriggerType;
  trigger_key: string;
  trigger_rca_record_id: string | null;
  occurrence_count: number;
  window_days: number;
  status: RcaFiveWhysStatus;
  root_cause_summary: string | null;
  opened_at: string;
  completed_at: string | null;
  completed_by: string | null;
}

export interface RcaFiveWhysAnswer {
  id: string;
  session_id: string;
  company_id: string;
  level: number;
  question: string;
  answer: string;
  answered_by: string | null;
  answered_by_email: string | null;
  created_at: string;
}

export interface RcaSettings {
  company_id: string;
  recurrence_threshold_count: number;
  recurrence_window_days: number;
  updated_at: string;
}

// Warehouse Digital Twin Types (Slotting Intelligence — Fase 3)
// Camada de junção/apresentação sobre dados que já existem em outros módulos (Slotting,
// Risk, CBC, ABC/XYZ, RCA) — não introduz nenhuma tabela nova.
export type WarehouseLiveLayer =
  | 'ocupacao'
  | 'divergencia'
  | 'picking'
  | 'giro'
  | 'risk'
  | 'confidence'
  | 'abc_xyz'
  | 'slotting'
  | 'vazios'
  | 'congestionamento';

export interface LocationLiveStatus {
  locationCode: string;
  productId: string | null;
  sku: string | null;
  productName: string | null;
  stockQuantity: number | null;
  occupied: boolean;
  pickCount: number;
  riskScore: number | null;
  riskLevel: RiskBand | null;
  riskReason: string | null;
  confidenceScore: number | null;
  confidenceLevel: RiskLevel | null;
  confidenceTopReasons: string[];
  abcClass: AbcClass | null;
  xyzClass: XyzClass | null;
  valueMoved: number | null;
  divergenceCount: number;
  lastCountAt: string | null;
  lastDivergenceAt: string | null;
  recommendation: WarehouseSlottingRecommendation | null;
}

export interface WarehouseInsight {
  id: string;
  icon: string;
  severity: 'info' | 'warning' | 'critical';
  category: string;
  title: string;
  impact: string;
  location: string | null;
  recommendation: string;
  /** Endereço exato para a câmera do mapa focar ao clicar no card — distinto de `location`
   *  (que pode ser um corredor inteiro, ex. "Rua C") para o zoom saber onde centralizar. */
  focusLocationCode: string | null;
}

/** Mesmo formato de "situação detectada + recomendação" do WarehouseInsight, generalizado
 *  para o painel BlindAI no Dashboard: cada situação cruza um sinal já calculado por um dos
 *  módulos de inteligência (Risco, Confidence, ABC/XYZ, RCA) e aponta para onde o usuário
 *  deve ir para agir — nenhum score é recalculado aqui, só lido e ranqueado. */
export interface BlindAISituation {
  id: string;
  icon: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  evidence: string;
  /** Fatores que justificam a recomendação, na ordem de peso — exibidos como lista, nunca
   *  uma conclusão sem explicação. */
  reasons: string[];
  recommendation: string;
  /** Aba do Dashboard para onde o card navega ao ser clicado. */
  module: 'risk' | 'cbc' | 'abcxyz' | 'rca';
  actionLabel: string;
}

/** Estrutura pronta para reconstrução histórica do CD — hoje `isMock` é sempre `true`
 *  (retorna o snapshot atual rotulado como prévia); quando houver persistência histórica
 *  real, só `warehouseTimelineService.ts` muda, nenhum consumidor precisa mudar. */
export interface WarehouseSnapshot {
  date: string;
  layoutId: string;
  cells: WarehouseCell[];
  liveData: Map<string, LocationLiveStatus>;
  isMock: boolean;
}
