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

/** Processo onde a divergência ocorreu — fixo (não configurável por workspace,
 *  diferente de categoria de causa), separado da causa em si desde a reformulação. */
export type RcaProcessArea =
  | 'recebimento'
  | 'armazenagem'
  | 'picking'
  | 'separacao'
  | 'expedicao'
  | 'inventario'
  | 'logistica_reversa'
  | 'cadastro'
  | 'integracao_sincronizacao'
  | 'outro';

/** Código de categoria de causa — configurável por workspace
 *  (rca_cause_categories/rca_cause_subcauses), por isso deixou de ser union
 *  literal. DEFAULT_CAUSE_CATEGORIES em rcaAlgorithm.ts documenta os códigos
 *  padrão fornecidos a toda empresa. */
export type RcaCauseCategory = string;

export type RcaSeverity = 'baixa' | 'media' | 'alta' | 'critica';
export type RcaClassificationStatus = 'classified' | 'pending';

// Legado (migration 033) — superado por rca_case_why_steps/RcaCaseWhyStep para
// novas investigações; tipos mantidos porque rca_five_whys_sessions/answers
// continuam existindo no banco (vazias, nunca removidas).
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
  process_area: RcaProcessArea | null;
  cause_category: RcaCauseCategory | null;
  subcause_code: string | null;
  custom_cause_label: string | null;
  notes: string | null;
  severity: RcaSeverity;
  classification_status: RcaClassificationStatus;
  containment_needed: boolean;
  known_recurrence: boolean;
  financial_impact: number | null;
  manual_escalation: boolean;
  rca_case_id: string | null;
  classified_by: string | null;
  classified_by_email: string | null;
  occurred_at: string;
  created_at: string;
}

export interface RcaCauseCategoryRow {
  id: string;
  company_id: string;
  code: string;
  label: string;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
}

export interface RcaCauseSubcauseRow {
  id: string;
  company_id: string;
  category_code: string;
  code: string;
  label: string;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
}

export type RcaCaseStatus =
  | 'rascunho' | 'em_investigacao' | 'causa_proposta' | 'plano_em_execucao'
  | 'aguardando_verificacao' | 'eficaz' | 'ineficaz_reaberto' | 'encerrado';

export type RcaRootCauseStatus = 'proposta' | 'confirmada';

export interface RcaCase {
  id: string;
  company_id: string;
  case_number: number;
  case_year: number;
  status: RcaCaseStatus;
  severity: RcaSeverity;
  process_area: RcaProcessArea;
  cause_category: RcaCauseCategory | null;
  subcause_code: string | null;
  problem_what: string;
  problem_where: string | null;
  problem_when: string | null;
  problem_impact_qty: number | null;
  problem_expected_pattern: string | null;
  problem_observed_result: string | null;
  financial_impact: number | null;
  owner_id: string | null;
  due_at: string | null;
  root_cause_text: string | null;
  root_cause_status: RcaRootCauseStatus | null;
  root_cause_confirmed_by: string | null;
  root_cause_confirmed_at: string | null;
  root_cause_justification: string | null;
  escalation_reasons: string[];
  opened_at: string;
  closed_at: string | null;
  closed_by: string | null;
  created_by: string;
  updated_by: string | null;
  updated_at: string;
}

export interface RcaCaseDivergenceLink {
  id: string;
  case_id: string;
  rca_record_id: string;
  company_id: string;
  linked_by: string | null;
  linked_at: string;
}

export type RcaWhyStepRole = 'sintoma' | 'causa_direta' | 'causa_contribuinte' | 'causa_raiz_proposta';

export interface RcaCaseWhyStep {
  id: string;
  case_id: string;
  company_id: string;
  parent_step_id: string | null;
  order_index: number;
  question: string;
  answer: string;
  role: RcaWhyStepRole;
  author_id: string | null;
  author_email: string | null;
  created_at: string;
  updated_at: string;
}

export type RcaActionType = 'contencao' | 'corretiva' | 'preventiva' | 'verificacao';
export type RcaVerificationResult = 'eficaz' | 'ineficaz';

export interface RcaCaseAction {
  id: string;
  case_id: string;
  company_id: string;
  action_type: RcaActionType;
  task_id: string | null;
  effectiveness_criteria: string | null;
  observation_window_days: number | null;
  expected_result: string | null;
  observed_result: string | null;
  verification_result: RcaVerificationResult | null;
  verified_by: string | null;
  verified_at: string | null;
  created_by: string | null;
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
