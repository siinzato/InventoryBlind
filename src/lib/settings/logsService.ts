// Configurações Avançadas > Logs — leitura paginada/filtrável de audit_logs.
// Reaproveita a tabela e o tipo já existentes em auditLogService.ts; não cria
// nada novo no banco. A tela de Segurança já tem uma tabela de auditoria mais
// simples (ação + paginação) — esta é a versão completa pedida (período,
// usuário, ação, resultado, busca textual, exportação), então vive à parte em
// vez de misturar dois conjuntos de filtro num componente já em uso.

import { supabase } from '../supabase';
import type { AuditLog } from '../auditLogService';

export const LOGS_PAGE_SIZE = 25;

export type LogOutcome = 'success' | 'denied';

/** Nenhuma coluna de resultado existe em audit_logs — o único sinal disponível
 *  hoje é o próprio nome da ação. Ações de recusa já seguem esse padrão em
 *  todo o código (`access.denied`); generalizado aqui para não exigir uma
 *  migration só para um filtro de tela. */
export function classifyLogOutcome(action: string): LogOutcome {
  return /denied|rejected|failed|reject|blocked/i.test(action) ? 'denied' : 'success';
}

export interface LogFilters {
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string;   // YYYY-MM-DD
  userEmail?: string;
  action?: string;
  outcome?: LogOutcome | 'all';
  searchText?: string;
}

export interface LogsPage {
  rows: AuditLog[];
  hasMore: boolean;
}

export async function listAuditLogs(
  companyId: string,
  filters: LogFilters,
  page: number,
  pageSize = LOGS_PAGE_SIZE
): Promise<LogsPage> {
  let query = supabase
    .from('audit_logs')
    .select('id, company_id, user_id, user_email, action, resource_type, resource_id, ip_address, user_agent, metadata, created_at, description')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);

  if (filters.dateFrom) query = query.gte('created_at', `${filters.dateFrom}T00:00:00.000Z`);
  if (filters.dateTo) query = query.lte('created_at', `${filters.dateTo}T23:59:59.999Z`);
  if (filters.userEmail) query = query.ilike('user_email', `%${filters.userEmail}%`);
  if (filters.action) query = query.ilike('action', `%${filters.action}%`);
  if (filters.searchText) {
    const term = filters.searchText.replace(/[%_]/g, '');
    query = query.or(`description.ilike.%${term}%,resource_type.ilike.%${term}%,resource_id.ilike.%${term}%`);
  }

  const { data, error } = await query;
  if (error) throw error;

  let rows = (data ?? []) as AuditLog[];
  if (filters.outcome && filters.outcome !== 'all') {
    rows = rows.filter(r => classifyLogOutcome(r.action) === filters.outcome);
  }

  return { rows, hasMore: (data ?? []).length === pageSize };
}

const SENSITIVE_KEY_PATTERN = /token|secret|senha|password|chave|credential|api[_-]?key|authorization/i;

/** Nunca mostra o valor de uma chave que pareça um segredo — mesmo que algum
 *  ponto do sistema tenha gravado algo sensível em metadata por engano, a
 *  tela de detalhe nunca reproduz o valor. */
export function redactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata ?? {})) {
    redacted[key] = SENSITIVE_KEY_PATTERN.test(key) ? '••••••••' : value;
  }
  return redacted;
}

function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV dos resultados já filtrados (a página carregada na tela — sem buscar
 *  tudo do banco de novo, coerente com a paginação pedida). */
export function logsToCsv(rows: AuditLog[]): string {
  const header = ['Data/Hora', 'Usuário', 'Ação', 'Recurso', 'ID do Recurso', 'Descrição', 'Resultado'];
  const lines = rows.map(r => [
    r.created_at,
    r.user_email,
    r.action,
    r.resource_type ?? '',
    r.resource_id ?? '',
    r.description ?? '',
    classifyLogOutcome(r.action) === 'denied' ? 'Negado' : 'Sucesso',
  ].map(csvEscape).join(','));
  return [header.join(','), ...lines].join('\n');
}
