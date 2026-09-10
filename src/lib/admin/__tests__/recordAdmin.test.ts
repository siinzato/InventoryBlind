import { describe, expect, it } from 'vitest';
import {
  ADMIN_ACTION_LABEL,
  MIN_ADMIN_REASON_LENGTH,
  RECORD_ADMIN_ROLES,
  buildReasonedRpcArgs,
  canAdministerRecords,
  canHardDelete,
  filterActive,
  filterArchived,
  isArchived,
  normalizeAdminReason,
  validateAdminReason,
} from '../recordAdmin';
import {
  buildCountCorrectionRpcArgs,
  buildInvoiceReasonRpcArgs,
  canCorrectInvoiceCounts,
  canHardDeleteInvoice,
  filterActiveInvoices,
  filterArchivedInvoices,
  isInvoiceArchived,
  parseCorrectionQuantity,
  validateCorrectionQuantity,
} from '../../nfe/nfeAdmin';

// O texto real das migrations. Mesmo mecanismo de intelligence/isolation.test.ts
// (import.meta.glob + ?raw): tsconfig.app.json cobre todo o `src` sem
// @types/node, então `node:fs` roda no vitest mas não passa no typecheck.
//
// Estes testes são estáticos por necessidade — não há Postgres para apontar. Eles
// pegam a remoção acidental de uma barreira, que é o risco realista; não
// substituem um teste de integração.
const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function migration(fragment: string): string {
  const key = Object.keys(MIGRATIONS).find(p => p.includes(fragment));
  return key ? MIGRATIONS[key] : '';
}

function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start === -1) return '';
  const end = sql.indexOf('$fn$;', start);
  return end === -1 ? '' : sql.slice(start, end);
}

const M061 = migration('061_physical_count_admin_restore_purge');
const M062 = migration('062_nfe_admin_controls');

const ALL_ROLES = ['owner', 'admin', 'manager', 'lead', 'counter', 'viewer'] as const;

// ── Autorização compartilhada ────────────────────────────────────────────────

describe('canAdministerRecords', () => {
  it('libera owner e admin, e mais ninguém', () => {
    expect(ALL_ROLES.filter(canAdministerRecords)).toEqual(['owner', 'admin']);
  });

  it('sem papel carregado ainda, não libera nada', () => {
    expect(canAdministerRecords(undefined)).toBe(false);
    expect(canAdministerRecords(null)).toBe(false);
    expect(canAdministerRecords('')).toBe(false);
  });

  it('a lista de papéis é a mesma para todos os módulos', () => {
    expect([...RECORD_ADMIN_ROLES]).toEqual(['owner', 'admin']);
  });
});

describe('validateAdminReason', () => {
  it('recusa vazio e só espaços', () => {
    for (const value of ['', '   ', null, undefined]) {
      expect(validateAdminReason(value)).not.toBeNull();
    }
  });

  it(`recusa menos de ${MIN_ADMIN_REASON_LENGTH} caracteres, sem contar espaços`, () => {
    expect(validateAdminReason('erro')).not.toBeNull();
    expect(validateAdminReason('  ab  ')).not.toBeNull();
  });

  it('aceita a partir do mínimo', () => {
    expect(validateAdminReason('erro!')).toBeNull();
    expect(validateAdminReason('nota duplicada na importação')).toBeNull();
  });

  it('normaliza tirando espaços das pontas', () => {
    expect(normalizeAdminReason('  motivo real  ')).toBe('motivo real');
  });
});

// ── Compatibilidade com banco sem a migration ────────────────────────────────

describe('isArchived / filtros', () => {
  it('coluna ausente conta como registro ativo', () => {
    // É o estado pré-migration: `select('*')` não devolve deleted_at, os
    // mapeadores resolvem para null, e a tela tem de continuar funcionando.
    expect(isArchived({ deletedAt: null })).toBe(false);
  });

  it('separa ativos e arquivados preservando a ordem', () => {
    const list = [
      { id: 'a', deletedAt: null },
      { id: 'b', deletedAt: '2026-08-20T12:00:00Z' },
      { id: 'c', deletedAt: null },
    ];
    expect(filterActive(list).map(r => r.id)).toEqual(['a', 'c']);
    expect(filterArchived(list).map(r => r.id)).toEqual(['b']);
  });
});

describe('canHardDelete', () => {
  const draftStatuses = ['draft'] as const;

  it('só rascunho, sem dependências e não arquivado', () => {
    expect(canHardDelete({ status: 'draft', deletedAt: null, hasDependents: false, draftStatuses })).toBe(true);
  });

  it('recusa quando já foi iniciado', () => {
    expect(canHardDelete({ status: 'in_progress', deletedAt: null, hasDependents: false, draftStatuses })).toBe(false);
  });

  it('recusa quando tem dependências', () => {
    expect(canHardDelete({ status: 'draft', deletedAt: null, hasDependents: true, draftStatuses })).toBe(false);
  });

  it('recusa registro arquivado — restaurar primeiro', () => {
    expect(canHardDelete({ status: 'draft', deletedAt: '2026-08-20', hasDependents: false, draftStatuses })).toBe(false);
  });
});

describe('buildReasonedRpcArgs', () => {
  it('envia só o id e o motivo — nunca empresa nem papel', () => {
    const args = buildReasonedRpcArgs('p_session_id', 'a1', '  faixa errada  ');
    expect(args).toEqual({ p_session_id: 'a1', p_reason: 'faixa errada' });
    expect(Object.keys(args)).toHaveLength(2);
  });
});

describe('ADMIN_ACTION_LABEL', () => {
  it('cobre todas as ações do vocabulário', () => {
    expect(Object.keys(ADMIN_ACTION_LABEL).sort()).toEqual([
      'archive',
      'correct',
      'edit',
      'hard_delete',
      'reopen',
      'restore',
    ]);
  });
});

// ── NF-e ─────────────────────────────────────────────────────────────────────

describe('nfeAdmin', () => {
  const finalized = { id: 'i1', status: 'completed' as const, deleted_at: null };
  const draft = { id: 'i2', status: 'not_started' as const, deleted_at: null };
  const archivedInvoice = { id: 'i3', status: 'completed' as const, deleted_at: '2026-08-20T10:00:00Z' };

  it('trata coluna ausente como nota ativa', () => {
    expect(isInvoiceArchived({})).toBe(false);
    expect(isInvoiceArchived({ deleted_at: null })).toBe(false);
    expect(isInvoiceArchived(archivedInvoice)).toBe(true);
  });

  it('separa ativas e arquivadas', () => {
    const list = [finalized, draft, archivedInvoice];
    expect(filterActiveInvoices(list).map(i => i.id)).toEqual(['i1', 'i2']);
    expect(filterArchivedInvoices(list).map(i => i.id)).toEqual(['i3']);
  });

  it('exclusão física só para nota nunca conferida', () => {
    expect(canHardDeleteInvoice(draft)).toBe(true);
    expect(canHardDeleteInvoice(finalized)).toBe(false);
    expect(canHardDeleteInvoice(archivedInvoice)).toBe(false);
  });

  it('correção só para nota já finalizada', () => {
    expect(canCorrectInvoiceCounts(finalized)).toBe(true);
    expect(canCorrectInvoiceCounts({ status: 'with_divergences', deleted_at: null })).toBe(true);
    // Em conferência o caminho é a contagem normal, que mantém a nota cega.
    expect(canCorrectInvoiceCounts({ status: 'in_progress', deleted_at: null })).toBe(false);
    expect(canCorrectInvoiceCounts(draft)).toBe(false);
    expect(canCorrectInvoiceCounts(archivedInvoice)).toBe(false);
  });

  it('o payload da nota leva só id e motivo', () => {
    expect(buildInvoiceReasonRpcArgs('i1', ' duplicada ')).toEqual({
      p_invoice_id: 'i1',
      p_reason: 'duplicada',
    });
  });

  it('o payload da correção leva só item, quantidade e motivo', () => {
    const args = buildCountCorrectionRpcArgs('it1', 7, ' recontado ');
    expect(args).toEqual({ p_item_id: 'it1', p_quantity: 7, p_reason: 'recontado' });
    for (const forbidden of ['p_company_id', 'p_invoice_id', 'p_status', 'p_expected_quantity']) {
      expect((args as Record<string, unknown>)[forbidden]).toBeUndefined();
    }
  });

  it('valida a quantidade corrigida, aceitando zero e vírgula decimal', () => {
    expect(validateCorrectionQuantity('')).not.toBeNull();
    expect(validateCorrectionQuantity('abc')).not.toBeNull();
    expect(validateCorrectionQuantity('-1')).not.toBeNull();
    // Zero é correção legítima: "conferi e não veio nenhum".
    expect(validateCorrectionQuantity('0')).toBeNull();
    expect(validateCorrectionQuantity('12,5')).toBeNull();
    expect(parseCorrectionQuantity('12,5')).toBe(12.5);
  });
});

// ── Migration 061 — Contagem Física ──────────────────────────────────────────

describe('migration 061', () => {
  for (const fn of ['pc_admin_restore_session', 'pc_admin_hard_delete_draft_session']) {
    describe(fn, () => {
      const body = functionBody(M061, fn);

      it('existe, é SECURITY DEFINER e fixa o search_path', () => {
        expect(body).not.toBe('');
        expect(body).toContain('SECURITY DEFINER');
        expect(body).toContain("SET search_path TO 'public'");
      });

      it('recusa não autenticado, papel sem permissão e empresa diferente', () => {
        expect(body).toContain('IF auth.uid() IS NULL THEN');
        expect(body).toContain("v_role NOT IN ('owner','admin')");
        expect(body).toContain('v_before.company_id::text <> v_company');
      });

      it('exige justificativa', () => {
        expect(body).toContain('char_length(v_reason) < 5');
      });

      it('grava auditoria na mesma transação', () => {
        expect(body).toContain('INSERT INTO audit_logs');
      });

      it('é revogada de PUBLIC e de anon', () => {
        expect(M061).toContain(`REVOKE EXECUTE ON FUNCTION public.${fn}(uuid, text) FROM PUBLIC;`);
        expect(M061).toContain(`REVOKE EXECUTE ON FUNCTION public.${fn}(uuid, text) FROM anon;`);
        expect(M061).toContain(`GRANT  EXECUTE ON FUNCTION public.${fn}(uuid, text) TO authenticated;`);
      });
    });
  }

  it('a exclusão física exige rascunho e recusa cada tipo de dependência', () => {
    const body = functionBody(M061, 'pc_admin_hard_delete_draft_session');
    expect(body).toContain("v_before.status <> 'draft'");
    // Cada dependência com a sua própria checagem e mensagem.
    expect(body).toContain('FROM physical_count_events WHERE session_id');
    expect(body).toContain('WHERE linked_session_id = p_session_id');
    expect(body).toContain('FROM erp_sync_events WHERE session_id');
    expect(body).toContain('FROM physical_count_recount_events');
  });

  it('a exclusão física audita ANTES do DELETE', () => {
    const body = functionBody(M061, 'pc_admin_hard_delete_draft_session');
    expect(body.indexOf('INSERT INTO audit_logs')).toBeLessThan(
      body.indexOf('DELETE FROM physical_count_sessions')
    );
  });

  it('a restauração limpa os três campos de arquivamento', () => {
    const body = functionBody(M061, 'pc_admin_restore_session');
    expect(body).toContain('deleted_at      = NULL');
    expect(body).toContain('deleted_by      = NULL');
    expect(body).toContain('deletion_reason = NULL');
    // E guarda por que a sessão estava fora, senão a restauração não se explica.
    expect(body).toContain("'previousDeletionReason'");
  });

  it('a reabertura passa a exigir owner/admin e a ser auditada', () => {
    const body = functionBody(M061, 'pc_reopen_session');
    expect(body).toContain("v_role NOT IN ('owner','admin')");
    expect(body).not.toContain("'manager'");
    expect(body).toContain("'physical_count.session_reopened'");
  });
});

// ── Migration 062 — NF-e ─────────────────────────────────────────────────────

describe('migration 062', () => {
  it('adiciona o arquivamento na nota e a marca de correção no log', () => {
    for (const column of ['deleted_at', 'deleted_by', 'deletion_reason']) {
      expect(M062).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
    for (const column of ['is_admin_correction', 'admin_reason', 'previous_quantity']) {
      expect(M062).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
  });

  it('fecha UPDATE e DELETE diretos na nota, e DELETE nos itens', () => {
    expect(M062).toContain('DROP POLICY IF EXISTS "nfe_invoices_update" ON nfe_invoices;');
    expect(M062).toContain('DROP POLICY IF EXISTS "nfe_invoices_delete" ON nfe_invoices;');
    expect(M062).toContain('DROP POLICY IF EXISTS "nfe_items_delete"    ON nfe_invoice_items;');
    expect(M062).not.toMatch(/CREATE POLICY/i);
  });

  it('PRESERVA o UPDATE dos itens, que linkItemToProduct usa', () => {
    // Remover esta policy quebraria o vínculo de produto na etapa de preparação.
    expect(M062).not.toContain('DROP POLICY IF EXISTS "nfe_items_update"');
  });

  it('a guarda de nota arquivada cobre nota, itens e eventos', () => {
    expect(M062).toContain('CREATE TRIGGER nfe_invoices_guard_archived');
    expect(M062).toContain('CREATE TRIGGER nfe_items_guard_archived');
    expect(M062).toContain('CREATE TRIGGER nfe_events_guard_archived');
    // Itens cobrem INSERT e UPDATE: linkItemToProduct grava direto pela RLS.
    expect(M062).toContain('BEFORE INSERT OR UPDATE ON nfe_invoice_items');
  });

  it('a guarda deixa passar exatamente a transição de arquivar/restaurar', () => {
    const body = functionBody(M062, 'nfe_guard_archived_invoice');
    expect(body).toContain('OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at');
  });

  for (const fn of [
    'nfe_admin_archive_invoice',
    'nfe_admin_restore_invoice',
    'nfe_admin_hard_delete_draft_invoice',
  ]) {
    describe(fn, () => {
      const body = functionBody(M062, fn);

      it('existe, é SECURITY DEFINER, com search_path fixo', () => {
        expect(body).not.toBe('');
        expect(body).toContain('SECURITY DEFINER');
        expect(body).toContain("SET search_path TO 'public'");
      });

      it('recusa não autenticado, papel errado, empresa diferente, e exige motivo', () => {
        expect(body).toContain('IF auth.uid() IS NULL THEN');
        expect(body).toContain("v_role NOT IN ('owner','admin')");
        expect(body).toContain('v_before.company_id::text <> v_company');
        expect(body).toContain('char_length(v_reason) < 5');
      });

      it('audita e é revogada de PUBLIC e anon', () => {
        expect(body).toContain('INSERT INTO audit_logs');
        expect(M062).toContain(`REVOKE EXECUTE ON FUNCTION public.${fn}(uuid, text) FROM PUBLIC;`);
        expect(M062).toContain(`REVOKE EXECUTE ON FUNCTION public.${fn}(uuid, text) FROM anon;`);
      });
    });
  }

  it('arquivar a nota não apaga nada', () => {
    const body = functionBody(M062, 'nfe_admin_archive_invoice');
    expect(body).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it('a exclusão física exige nota nunca conferida', () => {
    const body = functionBody(M062, 'nfe_admin_hard_delete_draft_invoice');
    expect(body).toContain("v_before.status <> 'not_started'");
    expect(body).toContain('FROM nfe_count_events WHERE invoice_id');
    expect(body).toContain('physical_quantity IS NOT NULL');
    expect(body.indexOf('INSERT INTO audit_logs')).toBeLessThan(body.indexOf('DELETE FROM nfe_invoices'));
  });

  it('a exclusão física NÃO copia o XML para a auditoria', () => {
    const body = functionBody(M062, 'nfe_admin_hard_delete_draft_invoice');
    // audit_logs é legível por todo owner/admin — documento fiscal inteiro não
    // entra ali. Registra-se só que existia.
    expect(body).toContain("'hadRawXml',     v_before.raw_xml IS NOT NULL");
    expect(body).not.toContain("'rawXml', v_before.raw_xml");
  });

  describe('nfe_admin_correct_count', () => {
    const body = functionBody(M062, 'nfe_admin_correct_count');

    it('recusa não autenticado, papel errado, empresa diferente e nota arquivada', () => {
      expect(body).toContain('IF auth.uid() IS NULL THEN');
      expect(body).toContain("v_role NOT IN ('owner','admin')");
      expect(body).toContain('v_item.company_id::text <> v_company');
      expect(body).toContain('v_invoice.deleted_at IS NOT NULL');
    });

    it('só age em nota finalizada', () => {
      expect(body).toContain("v_invoice.status NOT IN ('completed','with_divergences')");
    });

    it('acrescenta evento com valor anterior, valor novo, motivo e autor', () => {
      expect(body).toContain('INSERT INTO nfe_count_events');
      expect(body).toContain('previous_quantity');
      expect(body).toContain('admin_reason');
      expect(body).toContain('auth.uid()');
      // Nunca reescreve o log: nenhum UPDATE nem DELETE em nfe_count_events.
      expect(body).not.toMatch(/UPDATE\s+nfe_count_events/i);
      expect(body).not.toMatch(/DELETE\s+FROM\s+nfe_count_events/i);
    });

    it('registra a correção na auditoria com os dois valores', () => {
      expect(body).toContain("'nfe.count_corrected'");
      expect(body).toContain("'previousQuantity'");
      expect(body).toContain("'newQuantity'");
    });

    it('recalcula o status da nota, senão corrigir o último item deixaria "com divergências"', () => {
      expect(body).toContain('UPDATE nfe_invoices');
      expect(body).toContain('v_new_status');
    });
  });

  it('a reabertura da conferência passa a exigir owner/admin e a ser auditada', () => {
    const body = functionBody(M062, 'nfe_reopen_conference');
    expect(body).toContain("v_role NOT IN ('owner','admin')");
    expect(body).toContain("'nfe.conference_reopened'");
  });
});

// ── Regressão: nenhuma leitura pode exigir a coluna nova ─────────────────────
//
// Isto já quebrou a Contagem Física Digital em produção: um `.is('deleted_at',
// null)` na query referencia coluna que só existe depois da migration, o
// PostgREST devolve erro, e o Promise.all da tela cai inteiro — levando junto a
// lista de produtos, o que fazia a tela afirmar que a empresa não tinha produto
// cadastrado. Vale para todo módulo novo.

const SOURCES = import.meta.glob('/src/lib/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Código sem comentários — os comentários que explicam esta armadilha citam o
 *  próprio trecho proibido e casariam com a asserção. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('leituras compatíveis com banco sem a migration', () => {
  const services = ['/src/lib/nfe/nfeService.ts', '/src/lib/physicalCount/physicalCountService.ts'];

  for (const path of services) {
    it(`${path} não filtra deleted_at dentro da query`, () => {
      const source = SOURCES[path] ?? '';
      expect(source, `${path} deveria existir`).not.toBe('');
      const code = stripComments(source);
      expect(code).not.toContain(".is('deleted_at'");
      expect(code).not.toContain(".eq('deleted_at'");
      expect(code).not.toContain(".not('deleted_at'");
    });
  }

  it('e aplica o filtro no resultado', () => {
    expect(stripComments(SOURCES['/src/lib/nfe/nfeService.ts'] ?? '')).toContain('filterActiveInvoices(');
    expect(stripComments(SOURCES['/src/lib/physicalCount/physicalCountService.ts'] ?? '')).toContain(
      'filterVisibleSessions('
    );
  });
});
