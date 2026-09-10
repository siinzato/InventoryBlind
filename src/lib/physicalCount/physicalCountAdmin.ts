// Gerenciamento administrativo das sessões de Contagem Física — regras puras.
//
// As regras genéricas (quem administra, tamanho da justificativa, o que é um
// registro arquivado) vivem em lib/admin/recordAdmin.ts e são compartilhadas com
// NF-e e os demais módulos. Aqui fica só o que é específico de contagem.
//
// O banco é a autoridade: pc_admin_update_session e pc_admin_delete_session
// (migration 059) revalidam papel, empresa, estado da sessão e justificativa por
// conta própria, e são as ÚNICAS portas de escrita — a policy de UPDATE/DELETE
// direto em physical_count_sessions foi removida na mesma migration.
//
// Este arquivo existe para que a mesma regra que a UI usa para decidir o que
// mostrar seja testável sem banco, e para que a lista de campos editáveis viva
// num lugar só. Ele não é uma barreira de segurança: esconder um botão não
// impede ninguém de chamar a RPC.

import {
  MIN_ADMIN_REASON_LENGTH,
  RECORD_ADMIN_ROLES,
  buildReasonedRpcArgs,
  canAdministerRecords,
  filterActive,
  filterArchived,
  isArchived,
  validateAdminReason,
} from '../admin/recordAdmin';

/** Campos administrativos que a edição pode tocar.
 *
 *  Tudo o que está fora desta lista é histórico da contagem: faixa de
 *  localização, número da contagem, status, quantidades, saldo ERP congelado,
 *  datas, aprovação e o vínculo com recontagens. Reescrever qualquer um desses
 *  depois da criação deixaria o resultado inconsistente com o que foi contado —
 *  a faixa é o caso mais claro, porque os itens da sessão foram resolvidos a
 *  partir dela no momento da criação. */
export const EDITABLE_SESSION_FIELDS = ['warehouse', 'area', 'observation'] as const;

export type EditableSessionField = (typeof EDITABLE_SESSION_FIELDS)[number];

export interface SessionAdminFields {
  warehouse: string | null;
  area: string | null;
  observation: string | null;
}

/** Papéis com acesso ao gerenciamento administrativo do histórico de contagens.
 *
 *  Delegado a lib/admin/recordAdmin.ts para que todos os módulos usem a mesma
 *  definição. Os nomes locais continuam existindo porque são o vocabulário deste
 *  módulo, mas a regra é uma só. */
export const SESSION_ADMIN_ROLES = RECORD_ADMIN_ROLES;

export function canManageSessionHistory(role: string | null | undefined): boolean {
  return canAdministerRecords(role);
}

/** Status em que uma sessão ainda é rascunho — o único caso em que o hard delete
 *  é permitido (e mesmo assim só sem dependências, conferido no banco). */
export const DRAFT_SESSION_STATUSES = ['draft'] as const;

/** Texto vazio e texto só com espaços são a mesma coisa que "não informado" —
 *  guardar `''` deixaria a coluna com um valor que a UI mostra como preenchido. */
function normalizeText(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

export function normalizeSessionAdminFields(input: {
  warehouse?: string | null;
  area?: string | null;
  observation?: string | null;
}): SessionAdminFields {
  return {
    warehouse: normalizeText(input.warehouse),
    area: normalizeText(input.area),
    observation: normalizeText(input.observation),
  };
}

export function hasSessionAdminChanges(before: SessionAdminFields, after: SessionAdminFields): boolean {
  return EDITABLE_SESSION_FIELDS.some(field => before[field] !== after[field]);
}

/** Payload exato da chamada a pc_admin_update_session.
 *
 *  Construído aqui, e não no componente, para que o conjunto de chaves enviadas
 *  seja verificável por teste: um campo protegido acrescentado por descuido na
 *  tela não chega ao banco sem quebrar o teste antes. `company_id` nunca aparece
 *  — a empresa é resolvida no servidor a partir do usuário autenticado. */
export function buildSessionAdminRpcArgs(
  sessionId: string,
  fields: SessionAdminFields
): { p_session_id: string; p_warehouse: string | null; p_area: string | null; p_observation: string | null } {
  return {
    p_session_id: sessionId,
    p_warehouse: fields.warehouse,
    p_area: fields.area,
    p_observation: fields.observation,
  };
}

// ── Remoção do histórico (exclusão lógica) ───────────────────────────────────

export const MIN_DELETION_REASON_LENGTH = MIN_ADMIN_REASON_LENGTH;

export function validateDeletionReason(reason: string | null | undefined): string | null {
  return validateAdminReason(reason);
}

export function buildSessionDeletionRpcArgs(
  sessionId: string,
  reason: string
): { p_session_id: string; p_reason: string } {
  return buildReasonedRpcArgs('p_session_id', sessionId, reason) as {
    p_session_id: string;
    p_reason: string;
  };
}

/** Restauração e exclusão definitiva usam o mesmo formato: id + justificativa. */
export const buildSessionRestoreRpcArgs = buildSessionDeletionRpcArgs;
export const buildSessionHardDeleteRpcArgs = buildSessionDeletionRpcArgs;

// ── Visibilidade no histórico ────────────────────────────────────────────────

/** Uma sessão removida continua existindo (com quem removeu, quando e por quê),
 *  junto de todos os seus itens, eventos e recontagens — ela só sai da lista. */
export function isSessionVisibleInHistory(session: { deletedAt: string | null }): boolean {
  return !isArchived(session);
}

export function filterVisibleSessions<T extends { deletedAt: string | null }>(sessions: T[]): T[] {
  return filterActive(sessions);
}

/** O contrário: o que aparece na área de Arquivados. */
export function filterArchivedSessions<T extends { deletedAt: string | null }>(sessions: T[]): T[] {
  return filterArchived(sessions);
}
