// Controles administrativos — regras puras compartilhadas por todos os módulos.
//
// Uma única definição de "quem administra registros" e "o que é uma
// justificativa válida", para que Contagem Física, NF-e e os módulos seguintes
// não divirjam. As barreiras de verdade estão nas RPCs SECURITY DEFINER de cada
// módulo; este arquivo decide o que a tela mostra e monta os payloads, e é o que
// os testes podem exercitar sem banco.
//
// ── Regra de compatibilidade ─────────────────────────────────────────────────
// Nenhuma leitura pode referenciar `deleted_at` (ou qualquer coluna nova) DENTRO
// da query. Um `.is('deleted_at', null)` contra um banco onde a migration ainda
// não foi aplicada faz o PostgREST devolver erro, a leitura lançar, e o
// Promise.all da tela cair inteiro — foi exatamente assim que a Contagem Física
// Digital parou. O filtro é sempre aplicado no resultado, por
// `filterActive`/`filterArchived`, que tratam coluna ausente como "não
// arquivado". Ver o teste de regressão em physicalCountAdmin.test.ts.

/** Papéis com acesso aos controles administrativos.
 *
 *  Deliberadamente mais restrito que as permissões operacionais: `manager`
 *  continua reabrindo e aprovando o que já reabria e aprovava, mas arquivar,
 *  restaurar, corrigir e excluir ficam com quem responde pela conta. */
export const RECORD_ADMIN_ROLES = ['owner', 'admin'] as const;

export function canAdministerRecords(role: string | null | undefined): boolean {
  return role != null && (RECORD_ADMIN_ROLES as readonly string[]).includes(role);
}

// ── Justificativa ────────────────────────────────────────────────────────────

export const MIN_ADMIN_REASON_LENGTH = 5;

/** `null` quando serve; mensagem pronta para a tela quando não. A mesma
 *  exigência de tamanho é repetida em cada RPC, então contornar a tela não
 *  contorna a regra. */
export function validateAdminReason(reason: string | null | undefined): string | null {
  const trimmed = (reason ?? '').trim();
  if (trimmed === '') return 'Informe o motivo desta ação.';
  if (trimmed.length < MIN_ADMIN_REASON_LENGTH) {
    return `A justificativa precisa ter pelo menos ${MIN_ADMIN_REASON_LENGTH} caracteres.`;
  }
  return null;
}

export function normalizeAdminReason(reason: string): string {
  return reason.trim();
}

// ── Arquivamento (exclusão lógica) ───────────────────────────────────────────

/** Forma mínima que todo registro arquivável expõe. Cada módulo mapeia a sua
 *  linha para isto — camelCase no domínio, como o resto do projeto. */
export interface ArchivableRecord {
  deletedAt: string | null;
}

/** Coluna ausente (migration não aplicada) chega como `null` pelo `?? null` dos
 *  mapeadores, e `null` significa ativo. É o que mantém a tela funcionando antes
 *  e depois da migration. */
export function isArchived(record: ArchivableRecord): boolean {
  return record.deletedAt != null;
}

export function filterActive<T extends ArchivableRecord>(records: T[]): T[] {
  return records.filter(r => !isArchived(r));
}

export function filterArchived<T extends ArchivableRecord>(records: T[]): T[] {
  return records.filter(isArchived);
}

// ── Payloads das RPCs ────────────────────────────────────────────────────────

/**
 * Payload de uma ação administrativa que exige justificativa.
 *
 * Montado aqui, e não nos componentes, para que o conjunto de chaves enviadas
 * seja verificável por teste: um campo protegido acrescentado por descuido na
 * tela não chega ao banco sem quebrar o teste antes. `company_id` e o papel do
 * usuário NUNCA entram — os dois são resolvidos no servidor a partir de
 * `auth.uid()`.
 */
export function buildReasonedRpcArgs(
  idParam: string,
  id: string,
  reason: string
): Record<string, string> {
  return { [idParam]: id, p_reason: normalizeAdminReason(reason) };
}

// ── Ações administrativas, como vocabulário único ────────────────────────────

/** O conjunto fechado de ações administrativas do produto. Serve para os menus
 *  não inventarem rótulo próprio por módulo e para a auditoria ter nomes
 *  previsíveis. */
export type AdminActionKind = 'edit' | 'archive' | 'restore' | 'hard_delete' | 'correct' | 'reopen';

export const ADMIN_ACTION_LABEL: Record<AdminActionKind, string> = {
  edit: 'Editar',
  archive: 'Remover do histórico',
  restore: 'Restaurar',
  hard_delete: 'Excluir definitivamente',
  correct: 'Registrar correção',
  reopen: 'Reabrir',
};

/** Hard delete é permitido só para rascunho sem dependências. A decisão real é
 *  do banco (que conta eventos e filhos numa transação); isto é o espelho para a
 *  tela não oferecer um botão que vai falhar. */
export function canHardDelete(record: {
  status: string;
  deletedAt: string | null;
  hasDependents: boolean;
  draftStatuses: readonly string[];
}): boolean {
  if (isArchived(record)) return false;
  if (record.hasDependents) return false;
  return record.draftStatuses.includes(record.status);
}
