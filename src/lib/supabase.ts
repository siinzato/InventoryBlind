import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Types
export interface BrandData {
  id: string;
  brand: string;
  total_sku: number;
  done_sku: number;
  divergences: number;
  order_index: number;
  created_at: string;
  updated_at: string;
}

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
  category: 'pdf' | 'checklist' | 'pop' | 'template';
  external_url: string | null;
  is_placeholder: boolean;
  order_index: number;
  created_at: string;
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
  confidence_score: number;
  risk_level: RiskLevel;
  next_count_date: string;
  factors: Record<string, ConfidenceFactorBreakdown>;
  top_reasons: string[];
  algorithm_version: string;
  last_algorithm_run: string;
  created_at: string;
  updated_at: string;
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
  avg_confidence: number;
  total_scored: number;
  excelente_count: number;
  bom_count: number;
  medio_count: number;
  critico_count: number;
  overdue_count: number;
  due_this_week_count: number;
}

// Inventário por Risco (Risk Score) Types — semantically opposite to CBC:
// high score = MORE risk here, high score = MORE confidence in CBC.
export type RiskBand = 'critico' | 'alto' | 'medio' | 'baixo';
export type CriticalityLevel = 'baixa' | 'normal' | 'alta' | 'maxima';

export interface ProductRiskScore {
  id: string;
  company_id: string;
  product_id: string;
  risk_score: number;
  risk_level: RiskBand;
  risk_reason: string;
  factors: Record<string, ConfidenceFactorBreakdown>;
  algorithm_version: string;
  last_risk_update: string;
  created_at: string;
  updated_at: string;
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
  avg_risk: number;
  total_scored: number;
  critico_count: number;
  alto_count: number;
  medio_count: number;
  baixo_count: number;
}

// Classificação ABC+XYZ Types
export type AbcClass = 'A' | 'B' | 'C';
export type XyzClass = 'X' | 'Y' | 'Z';
export type AbcXyzCombo = 'AX' | 'AY' | 'AZ' | 'BX' | 'BY' | 'BZ' | 'CX' | 'CY' | 'CZ';

export interface ProductAbcXyzClassification {
  id: string;
  company_id: string;
  product_id: string;
  abc_class: AbcClass;
  xyz_class: XyzClass;
  abc_xyz_class: AbcXyzCombo;
  classification_date: string;
  value_moved: number;
  demand_coefficient_variation: number | null;
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
  recorded_at: string;
}

// Slotting Intelligence Types
export type WarehouseCellType = 'rua' | 'modulo' | 'posicao' | 'expedicao' | 'vazio' | 'porta' | 'doca';
export type SlottingRecommendationType = 'mover_mais_perto' | 'aproximar_expedicao' | 'agrupar_frequentes' | 'redistribuir_fluxo';
export type SlottingRecommendationStatus = 'pendente' | 'aprovada' | 'rejeitada' | 'adiada';

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

// Root Cause Analysis (RCA) Types
export type RcaSourceModule = 'import_count' | 'full_operation' | 'nfe_receiving';
export type RcaCauseCategory =
  | 'recebimento'
  | 'armazenagem'
  | 'picking'
  | 'separacao'
  | 'expedicao'
  | 'inventario'
  | 'furto_perda'
  | 'avaria'
  | 'cadastro'
  | 'conversao_unidade'
  | 'erro_operacional'
  | 'sistema_integracao'
  | 'sem_causa_identificada'
  | 'outro';
export type RcaFiveWhysTriggerType = 'sku' | 'cause_category';
export type RcaFiveWhysStatus = 'open' | 'completed';

export interface RcaRecord {
  id: string;
  company_id: string;
  source_module: RcaSourceModule;
  source_item_id: string;
  product_id: string | null;
  sku: string | null;
  product_name: string | null;
  location: string | null;
  operator_user_id: string | null;
  operator_name: string | null;
  supplier_name: string | null;
  supplier_cnpj: string | null;
  divergence_qty: number;
  cause_category: RcaCauseCategory;
  custom_cause_label: string | null;
  notes: string | null;
  classified_by: string | null;
  classified_by_email: string | null;
  occurred_at: string;
  created_at: string;
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
