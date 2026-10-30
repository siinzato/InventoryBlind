// Guardas da migration 116 — WMS: pulmão endereçado.
//
// Mesmo mecanismo dos outros migrationGuards do projeto: não roda SQL (não há Postgres
// local), lê o arquivo e trava as propriedades que o desenho depende. O que importa aqui
// não é sintaxe — é que as invariantes do modelo continuem valendo depois de qualquer
// edição: saldo só muda por movimento, nada toca o picking, e as guardas falham fechado.

import { describe, expect, it } from 'vitest';

const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// CRLF normalizado: os recortes por fim de função abaixo não casariam num arquivo com \r\n.
const M116 = (
  MIGRATIONS[Object.keys(MIGRATIONS).find(p => p.includes('116_wms_pulmao_enderecado')) ?? ''] ?? ''
).replace(/\r\n/g, '\n');

const fnBody = (name: string): string => {
  const start = M116.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  if (start < 0) return '';
  const end = M116.indexOf('$function$;', start);
  return M116.slice(start, end < 0 ? undefined : end);
};

describe('116 — existe e é aditiva', () => {
  it('existe e não está vazia', () => {
    expect(M116.length).toBeGreaterThan(0);
  });

  it('não apaga nem desabilita nada', () => {
    expect(M116).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(M116).not.toMatch(/\bTRUNCATE\b/i);
    expect(M116).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it('não altera nenhuma tabela existente', () => {
    const alters = M116.match(/ALTER TABLE (\w+)/g) ?? [];
    const novas = ['warehouse_storage_bins', 'warehouse_bin_stock', 'warehouse_bin_movements'];
    for (const alter of alters) {
      expect(novas.some(t => alter.endsWith(t))).toBe(true);
    }
  });

  // O usuário foi explícito: o vão de picking é das capas e não entra neste módulo.
  it('não encosta no picking nem no endereço do produto', () => {
    const executavel = M116.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--.*/g, ' ');
    for (const proibido of ['products.location', 'inventory_items', 'warehouse_cells', 'integration_connections']) {
      expect(executavel.includes(proibido)).toBe(false);
    }
  });
});

describe('116 — saldo é consequência de movimento, nunca digitação', () => {
  it('as tabelas de saldo e movimento só têm policy de SELECT', () => {
    const policies = M116.match(/CREATE POLICY "wms_(stock|movements)_\w+" ON \w+ FOR (\w+)/g) ?? [];
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) {
      expect(policy).toMatch(/FOR SELECT$/);
    }
  });

  it('o histórico não tem policy de DELETE em lugar nenhum', () => {
    expect(M116).not.toMatch(/CREATE POLICY[^;]*warehouse_bin_movements[^;]*FOR DELETE/i);
    expect(M116).not.toMatch(/CREATE POLICY[^;]*warehouse_bin_stock[^;]*FOR DELETE/i);
  });

  it('endereço não se apaga, se bloqueia', () => {
    expect(M116).not.toMatch(/CREATE POLICY[^;]*warehouse_storage_bins[^;]*FOR DELETE/i);
    expect(M116).toContain('blocked        boolean NOT NULL DEFAULT false');
  });

  it('toda movimentação grava autor e tem forma validada', () => {
    expect(M116).toContain('created_by     uuid REFERENCES auth.users(id)');
    const shape = M116.slice(M116.indexOf('warehouse_bin_movements_shape'));
    expect(shape).toContain("movement_type = 'entrada'       AND from_bin_id IS NULL     AND to_bin_id IS NOT NULL");
    expect(shape).toContain("movement_type = 'saida'         AND from_bin_id IS NOT NULL AND to_bin_id IS NULL");
    expect(shape).toContain('from_bin_id IS DISTINCT FROM to_bin_id');
  });
});

describe('116 — as guardas falham FECHADO (lição da 115)', () => {
  const guard = fnBody('wms_require_operator');

  it('testa NULL de sessão, empresa e papel ANTES de comparar papel', () => {
    const nulo = guard.indexOf('v_role IS NULL');
    const papel = guard.indexOf("v_role NOT IN ('owner','admin','manager','counter','lead')");
    expect(nulo).toBeGreaterThan(-1);
    expect(papel).toBeGreaterThan(-1);
    expect(nulo).toBeLessThan(papel);
    expect(guard).toContain('auth.uid() IS NULL');
    expect(guard).toContain('v_company IS NULL');
  });

  it('toda RPC fixa o search_path e é SECURITY DEFINER', () => {
    for (const fn of ['wms_require_operator', 'wms_resolve_bin', 'wms_bin_putaway', 'wms_bin_pick', 'wms_bin_transfer']) {
      const body = fnBody(fn);
      expect(body).toContain('SECURITY DEFINER');
      expect(body).toContain("SET search_path TO 'public'");
    }
  });

  it('as três RPCs públicas passam pela guarda de papel', () => {
    for (const fn of ['wms_bin_putaway', 'wms_bin_pick', 'wms_bin_transfer']) {
      expect(fnBody(fn)).toContain('v_company := wms_require_operator();');
    }
  });

  // SECURITY DEFINER não herda RLS: o filtro por empresa tem que ser escrito à mão.
  it('resolver endereço filtra por empresa explicitamente', () => {
    expect(fnBody('wms_resolve_bin')).toContain('WHERE company_id = p_company AND code = btrim(p_code)');
  });

  it('anon não executa nada, e as auxiliares não são RPC', () => {
    expect(M116).not.toMatch(/GRANT[^;]*\bTO\b[^;]*\banon\b/i);
    for (const fn of ['wms_require_operator()', 'wms_resolve_bin(text, text, boolean)']) {
      const revoke = M116.split('\n').find(l => l.includes(`REVOKE EXECUTE ON FUNCTION public.${fn}`)) ?? '';
      expect(revoke).toContain('FROM PUBLIC, anon, authenticated;');
    }
  });
});

describe('116 — invariantes de estoque', () => {
  it('não deixa somar caixas de pack diferente no mesmo saldo', () => {
    for (const fn of ['wms_bin_putaway', 'wms_bin_transfer']) {
      expect(fnBody(fn)).toContain('units_per_box IS DISTINCT FROM');
    }
  });

  it('retirar confere saldo e trava a linha', () => {
    const pick = fnBody('wms_bin_pick');
    expect(pick).toContain('FOR UPDATE');
    expect(pick).toContain('IF p_boxes > v_boxes THEN');
  });

  it('a idade do lote não rejuvenesce ao somar nem ao transferir', () => {
    // No putaway, first_stored_at fica fora do DO UPDATE.
    const putaway = fnBody('wms_bin_putaway');
    const doUpdate = putaway.slice(putaway.indexOf('ON CONFLICT (company_id, bin_id, product_id) DO UPDATE'));
    expect(doUpdate.slice(0, doUpdate.indexOf(';'))).not.toContain('first_stored_at');
    // Na transferência, a data viaja junto e o destino fica com a mais antiga.
    expect(fnBody('wms_bin_transfer')).toContain('LEAST(warehouse_bin_stock.first_stored_at, EXCLUDED.first_stored_at)');
  });

  it('endereço bloqueado recusa guardar mas permite esvaziar', () => {
    expect(fnBody('wms_bin_putaway')).toContain('wms_resolve_bin(v_company, p_bin_code, true)');
    expect(fnBody('wms_bin_pick')).toContain('wms_resolve_bin(v_company, p_bin_code, false)');
  });

  it('a consulta por produto respeita a RLS de quem pergunta', () => {
    expect(M116).toContain('CREATE OR REPLACE VIEW wms_product_stock_v');
    expect(M116).toContain('WITH (security_invoker = true)');
  });
});

// ── Fase 2 ────────────────────────────────────────────────────────────────────────────

const M118 = (
  MIGRATIONS[Object.keys(MIGRATIONS).find(p => p.includes('118_wms_capacity_guard')) ?? ''] ?? ''
).replace(/\r\n/g, '\n');

describe('118 — capacidade não cai abaixo do que já está guardado', () => {
  it('existe e é aditiva', () => {
    expect(M118.length).toBeGreaterThan(0);
    expect(M118).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(M118).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(M118).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  // A capacidade muda por UPDATE direto na tabela, nao por RPC. Validar so na tela
  // deixaria a regra fora do banco e qualquer outro caminho a contornaria.
  it('a garantia é trigger no banco, não checagem de formulário', () => {
    expect(M118).toContain('BEFORE UPDATE OF capacity_boxes ON warehouse_storage_bins');
    expect(M118).toContain('EXECUTE FUNCTION wms_guard_bin_capacity()');
  });

  it('compara contra o saldo real e recusa quando não cabe', () => {
    const body = M118.slice(M118.indexOf('CREATE OR REPLACE FUNCTION public.wms_guard_bin_capacity'));
    expect(body).toContain('FROM warehouse_bin_stock');
    expect(body).toContain('WHERE bin_id = NEW.id');
    expect(body).toContain('IF NEW.capacity_boxes < v_ocupado THEN');
    expect(body).toContain('RAISE EXCEPTION');
  });

  it('capacidade nula segue significando sem limite', () => {
    expect(M118).toContain('IF NEW.capacity_boxes IS NULL THEN');
  });

  // Salvar o formulario sem mexer na capacidade de um endereco ja lotado nao pode ser
  // recusado: `UPDATE OF` dispara mesmo quando o valor nao mudou.
  it('valor inalterado passa direto', () => {
    expect(M118).toContain('IF NEW.capacity_boxes IS NOT DISTINCT FROM OLD.capacity_boxes THEN');
  });

  it('não é RPC: anon e PUBLIC não executam', () => {
    expect(M118).toContain('REVOKE EXECUTE ON FUNCTION public.wms_guard_bin_capacity() FROM PUBLIC, anon;');
    expect(M118).not.toMatch(/GRANT[^;]*\bTO\b[^;]*\banon\b/i);
  });

  // A 116 ja barrava ENTRAR acima da capacidade; a 118 fecha o caminho inverso. As duas
  // guardas precisam coexistir.
  it('não desfaz a validação de entrada que a 116 já tinha', () => {
    expect(M116).toContain('Capacidade do endereço % excedida');
    // Só o SQL executável: o cabeçalho da 118 CITA as duas RPCs para explicar que elas já
    // cobrem o caminho de entrada. Sem tirar comentário, a asserção casaria com a prosa.
    const executavel = M118.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--.*/g, ' ');
    expect(executavel).not.toContain('wms_bin_putaway');
    expect(executavel).not.toContain('wms_bin_transfer');
  });
});
