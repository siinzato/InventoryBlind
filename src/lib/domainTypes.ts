// Tipos de domínio puros — zero imports, zero acoplamento a ambiente (nada de
// import.meta.env). Existem separados de supabase.ts especificamente para que os arquivos
// *Algorithm.ts (sem I/O, reaproveitados também dentro da Edge Function do BlindAI em
// Deno) possam importar tipos sem arrastar o singleton do client Supabase — aquele arquivo
// usa import.meta.env, que não existe em Deno, e um `deno check` falha ao tentar
// type-checar essa cadeia mesmo quando o import do lado de cá é `import type`.
//
// supabase.ts reexporta tudo daqui — nenhum import existente em outros arquivos do app
// precisa mudar.

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

export type AbcClass = 'A' | 'B' | 'C';
export type XyzClass = 'X' | 'Y' | 'Z';
export type AbcXyzCombo = 'AX' | 'AY' | 'AZ' | 'BX' | 'BY' | 'BZ' | 'CX' | 'CY' | 'CZ';

export type BlindAIPriority = 'P1' | 'P2' | 'P3' | 'P4';

/** Ranking de prioridade de linha (inventory_brands) calculado por
 *  blindAIAgentAlgorithm.ts — só usa campos que já existem em BrandRow (progresso,
 *  divergências, acuracidade); não há vínculo de schema entre inventory_brands e
 *  products/product_risk_scores, então este ranking nunca cruza com risco/ABC-XYZ
 *  por SKU — apenas com o que a linha realmente tem registrado. */
export interface BlindAILineRanking {
  brand: string;
  priority: BlindAIPriority;
  score: number;
  pendingSku: number;
  divergences: number;
  accuracy: number | null;
  reasons: string[];
}
