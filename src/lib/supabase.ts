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
