// Diagnóstico da operação — persistência.
//
// Guarda no metadata do próprio usuário no Supabase Auth (`raw_user_meta_data`, o
// mesmo lugar onde o cadastro já grava `name`). Nenhuma tabela, coluna, policy ou
// migration nova: o dado é do usuário, é pequeno e não é consultado por outro
// módulo, então criar schema para ele seria estrutura sem consumidor.
//
// O rascunho fica em localStorage para "Salvar e continuar depois" e para sobreviver
// a um reload sem depender de round-trip. Quando o diagnóstico é concluído, o
// resultado vai para o servidor e o rascunho é descartado.
//
// ── Falhar aqui nunca pode barrar o acesso ──────────────────────────────────
// Toda escrita devolve um booleano em vez de lançar, e toda leitura tem fallback.
// O diagnóstico é opcional: se a gravação falhar, a pessoa continua usando o
// sistema normalmente e no máximo será convidada a responder de novo.

import { supabase } from './supabase';
import type { DiagnosticAnswers } from './operationDiagnostic';
import type { PlanKey } from './plans';

const DRAFT_KEY = 'ib_operation_diagnostic_draft';
const METADATA_KEY = 'operation_diagnostic';

export interface DiagnosticRecord {
  answers: DiagnosticAnswers;
  recommendedPlan: PlanKey;
  /** ISO. Gravado pelo cliente porque não há endpoint próprio para isto. */
  completedAt: string;
}

export interface DiagnosticDraft {
  answers: DiagnosticAnswers;
  stepIndex: number;
}

// ── Rascunho local ──────────────────────────────────────────────────────────

export function readDraft(): DiagnosticDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DiagnosticDraft;
    return parsed && typeof parsed === 'object' && parsed.answers ? parsed : null;
  } catch {
    return null;
  }
}

export function writeDraft(draft: DiagnosticDraft): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Navegação privada ou storage cheio — o fluxo continua em memória.
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Idem.
  }
}

// ── Resultado no metadata do usuário ────────────────────────────────────────

/** O que já foi respondido por este usuário, ou null.
 *
 *  Lê do objeto de usuário que o chamador já tem em mãos — evita uma ida ao
 *  servidor só para descobrir se o convite ao diagnóstico deve aparecer. */
export function readCompleted(userMetadata: Record<string, unknown> | undefined): DiagnosticRecord | null {
  const raw = userMetadata?.[METADATA_KEY];
  if (raw == null || typeof raw !== 'object') return null;

  const record = raw as Partial<DiagnosticRecord>;
  if (record.answers == null || record.recommendedPlan == null) return null;

  return {
    answers: record.answers,
    recommendedPlan: record.recommendedPlan,
    completedAt: record.completedAt ?? '',
  };
}

/** Grava o resultado. `false` = não persistiu; o chamador segue mesmo assim. */
export async function saveCompleted(record: DiagnosticRecord): Promise<boolean> {
  try {
    const { error } = await supabase.auth.updateUser({ data: { [METADATA_KEY]: record } });
    if (error) {
      console.error('[diagnóstico] falha ao salvar:', error.message);
      return false;
    }
    clearDraft();
    return true;
  } catch (thrown) {
    console.error('[diagnóstico] falha ao salvar:', thrown);
    return false;
  }
}
