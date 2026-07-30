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
