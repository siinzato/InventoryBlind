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
