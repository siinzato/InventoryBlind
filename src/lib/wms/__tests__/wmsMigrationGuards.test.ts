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

/**
 * O corpo da função como ela está declarada POR ÚLTIMO.
 *
 * Lia só a 116, e isso era uma armadilha: no dia em que uma migration posterior
 * redeclarasse `wms_bin_pick` — e a 136 redeclara — as guardas continuariam passando
 * contra um texto morto. Teste que afirma sobre uma declaração substituída não protege
 * nada, e passa verde enquanto a função viva faz outra coisa.
 *
 * Varre as migrations em ordem de nome (= ordem de versão) e devolve a ÚLTIMA.
 */
const ARQUIVOS_EM_ORDEM = Object.keys(MIGRATIONS).sort();

const fnBody = (name: string): string => {
  for (const caminho of [...ARQUIVOS_EM_ORDEM].reverse()) {
    const sql = MIGRATIONS[caminho].replace(/\r\n/g, '\n');
    const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
    if (start < 0) continue;
    const end = sql.indexOf('$function$;', start);
    return sql.slice(start, end < 0 ? undefined : end);
  }
  return '';
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

// ── Reserva de estoque ────────────────────────────────────────────────────────────────

const migracao = (trecho: string): string =>
  (MIGRATIONS[Object.keys(MIGRATIONS).find(p => p.includes(trecho)) ?? ''] ?? '').replace(/\r\n/g, '\n');

const M134 = migracao('134_wms_reserva_disponibilidade');
const M135 = migracao('135_wms_revoke_expire_reservations');
const M136 = migracao('136_wms_pick_ciente_de_reserva');

describe('134 — reserva e disponibilidade', () => {
  it('existe e é aditiva', () => {
    expect(M134.length).toBeGreaterThan(0);
    expect(M134).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(M134).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    // TRUNCATE só pode aparecer como privilégio REVOGADO. A 116 proíbe a palavra inteira,
    // e aqui isso acusaria justamente a linha que TIRA o privilégio de esvaziar a tabela —
    // guarda que reprova a correção é guarda que acaba desligada.
    const semConcessoes = M134.replace(/^\s*(REVOKE|GRANT)[\s\S]*?;$/gim, ' ');
    expect(semConcessoes).not.toMatch(/\bTRUNCATE\b/i);
    // Não redeclara as RPCs de produção: isso é assunto da 136, sozinha.
    const executavel = M134.replace(/--.*/g, ' ');
    expect(executavel).not.toContain('FUNCTION public.wms_bin_pick');
    expect(executavel).not.toContain('FUNCTION public.wms_bin_putaway');
  });

  it('reserva tem sempre endereço e dono', () => {
    const tabela = M134.slice(
      M134.indexOf('CREATE TABLE IF NOT EXISTS warehouse_stock_reservations'),
      M134.indexOf('COMMENT ON TABLE'),
    );
    expect(tabela).toMatch(/bin_id\s+uuid NOT NULL/);
    expect(tabela).toMatch(/owner_id\s+uuid NOT NULL/);
    expect(tabela).toMatch(/owner_kind\s+text NOT NULL/);
    // Reserva liquidada sem data (ou aberta com data) é estado que não se audita.
    expect(tabela).toContain("CHECK ((status = 'aberta') = (settled_at IS NULL))");
  });

  it('escrever reserva é só por RPC, como o saldo', () => {
    expect(M134).toContain('ALTER TABLE warehouse_stock_reservations ENABLE ROW LEVEL SECURITY');
    const policies = M134.match(/CREATE POLICY \w+ ON warehouse_stock_reservations\s+FOR (\w+)/g) ?? [];
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) expect(policy).toMatch(/FOR SELECT/);
    expect(M134).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE\s+ON warehouse_stock_reservations FROM anon, authenticated/);
  });

  it('fecha a escrita direta que estava aberta no saldo', () => {
    expect(M134).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE\s+ON warehouse_bin_stock, warehouse_bin_movements FROM anon, authenticated/);
  });

  it('disponível é derivado, e a view respeita a RLS de quem pergunta', () => {
    for (const view of ['wms_bin_availability_v', 'wms_product_availability_v']) {
      const corpo = M134.slice(M134.indexOf('CREATE OR REPLACE VIEW ' + view));
      expect(corpo.slice(0, corpo.indexOf('AS'))).toContain('security_invoker = true');
    }
    // Disponível NÃO pode existir como coluna em lugar nenhum.
    expect(M134).not.toMatch(/ADD COLUMN\s+boxes_(reservado|disponivel)/i);
  });

  it('reservar trava o saldo antes de decidir', () => {
    const corpo = fnBody('wms_reserve_stock');
    expect(corpo).toContain('v_company := wms_require_operator();');
    expect(corpo).toContain('FOR UPDATE');
    expect(corpo).toContain('v_reservado + p_boxes > v_boxes');
    // Endereço bloqueado não vira promessa de separação.
    expect(corpo).toContain('wms_resolve_bin(v_company, p_bin_code, true)');
  });
});

describe('135 — a varredura não é ação de tela', () => {
  it('revoga de authenticated por nome, não só de public', () => {
    // O ALTER DEFAULT PRIVILEGES do Supabase concede EXECUTE a anon e authenticated em
    // toda função nova: revogar de `public` deixa authenticated com o privilégio. Isto
    // foi MEDIDO chamando a função pela sessão do app, não deduzido.
    expect(M135).toMatch(/REVOKE ALL ON FUNCTION public\.wms_expire_reservations\(\) FROM public, anon, authenticated/);
    expect(M135).toMatch(/GRANT EXECUTE ON FUNCTION public\.wms_expire_reservations\(\) TO service_role/);
    expect(M135).not.toMatch(/GRANT[^;]*wms_expire_reservations[^;]*TO[^;]*authenticated/);
  });
});

describe('136 — separação ciente de reserva', () => {
  it('não cria sobrecarga do pick: a assinatura continua a de quatro argumentos', () => {
    // CREATE OR REPLACE com outro número de argumentos não substitui, cria sobrecarga —
    // e aí TODA chamada de quatro argumentos passa a falhar com "function is not unique".
    const assinatura = M136.slice(
      M136.indexOf('CREATE OR REPLACE FUNCTION public.wms_bin_pick'),
      M136.indexOf('RETURNS uuid'),
    );
    expect(assinatura).toContain('p_bin_code');
    expect(assinatura).toContain('p_product_id');
    expect(assinatura).toContain('p_boxes');
    expect(assinatura).toContain('p_reason');
    expect(assinatura).not.toContain('p_owner');
    expect(M136).not.toMatch(/\bDROP\s+FUNCTION\b/i);
  });

  it('a regra é uma só, e vale nos dois caminhos', () => {
    // físico restante >= reservado aberto. É ela que impede tanto a retirada avulsa de
    // comer reserva quanto o endereço de zerar deixando reserva órfã.
    expect(fnBody('wms_bin_pick')).toContain('v_boxes - p_boxes < v_abertas');
  });

  it('o pick continua honrando as invariantes antigas', () => {
    // A 116 já exigia isto; como a 136 redeclara a função, a exigência tem de sobreviver
    // à nova declaração — é exatamente o que se perde em silêncio numa redeclaração.
    const pick = fnBody('wms_bin_pick');
    expect(pick).toContain('v_company := wms_require_operator();');
    expect(pick).toContain('SECURITY DEFINER');
    expect(pick).toContain("SET search_path TO 'public'");
    expect(pick).toContain('FOR UPDATE');
    expect(pick).toContain('wms_resolve_bin(v_company, p_bin_code, false)');
    // A baixa registra uma SAÍDA do endereço, com quem fez. Asserção por partes e não
    // pela linha inteira: a 137 acrescentou `movement_reason` no mesmo INSERT, e travar
    // o texto exato transformaria qualquer acréscimo legítimo em falha — guarda que
    // reprova a evolução acaba desligada.
    expect(pick).toContain("INSERT INTO warehouse_bin_movements");
    expect(pick).toContain("'saida'");
    expect(pick).toContain('from_bin_id');
    expect(pick).toContain('auth.uid()');
  });

  it('consumo parcial divide a linha em vez de marcar a reserva inteira', () => {
    const onda = fnBody('wms_pick_for_wave');
    expect(onda).toContain("status = 'consumida'");
    expect(onda).toContain('SET boxes = boxes - v_restante');
    expect(onda).toContain('INSERT INTO warehouse_stock_reservations');
    // Mais antiga primeiro: consumir a mais nova deixaria a velha envelhecendo presa.
    expect(onda).toContain('ORDER BY created_at, id');
  });

  it('a onda trava o saldo antes das reservas', () => {
    const onda = fnBody('wms_pick_for_wave');
    const saldo = onda.indexOf('FROM warehouse_bin_stock');
    const reservas = onda.indexOf('FROM warehouse_stock_reservations');
    expect(saldo).toBeGreaterThan(-1);
    expect(reservas).toBeGreaterThan(saldo);
  });

  it('a baixa continua existindo em um lugar só', () => {
    const onda = fnBody('wms_pick_for_wave');
    expect(onda).toContain('wms_bin_pick(p_bin_code, p_product_id, p_boxes, p_reason)');
    // Nada de DELETE/UPDATE de saldo nem INSERT de movimento duplicado aqui dentro.
    expect(onda).not.toContain('DELETE FROM warehouse_bin_stock');
    expect(onda).not.toContain('INSERT INTO warehouse_bin_movements');
  });

  it('endereço que zera não deixa reserva órfã passar calada', () => {
    expect(fnBody('wms_pick_for_wave')).toContain('estado inconsistente, operação desfeita');
  });

  it('a RPC nova revoga de authenticated por nome antes de conceder', () => {
    expect(M136).toMatch(/REVOKE ALL ON FUNCTION public\.wms_pick_for_wave\([^)]*\) FROM public, anon, authenticated/);
    expect(M136).toMatch(/GRANT EXECUTE ON FUNCTION public\.wms_pick_for_wave\([^)]*\) TO authenticated/);
  });
});

const M137 = migracao('137_wms_motivo_padrao_e_endereco_inativo');

describe('137 — motivo padronizado e endereço desativado', () => {
  it('existe e é aditiva', () => {
    expect(M137.length).toBeGreaterThan(0);
    expect(M137).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(M137).not.toMatch(/\bDROP\s+FUNCTION\b/i);
    expect(M137).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it('NÃO trava a nota humana em lista fechada', () => {
    // `wms_nfe_putaway` grava 'Recebimento NF-e <numero>' em `reason`. Um CHECK ali
    // recusaria todo recebimento de nota fiscal — o módulo parado para padronizar um
    // rótulo. A lista fechada vive em `movement_reason`, que é outro eixo.
    const checks = M137.match(/CHECK \([^;]*\)/g) ?? [];
    expect(checks.length).toBeGreaterThan(0);
    for (const check of checks) {
      expect(check).not.toMatch(/\breason\b(?!_)/);
    }
  });

  it('a coluna nasce anulável, é preenchida, e só então trava', () => {
    const add = M137.indexOf('ADD COLUMN IF NOT EXISTS movement_reason');
    const backfill = M137.indexOf('SET movement_reason = CASE');
    const notNull = M137.indexOf('ALTER COLUMN movement_reason SET NOT NULL');
    expect(add).toBeGreaterThan(-1);
    expect(backfill).toBeGreaterThan(add);
    expect(notNull).toBeGreaterThan(backfill);
    // Sem DEFAULT: INSERT que esqueça de classificar tem de FALHAR, não herdar um
    // motivo plausível.
    expect(M137.slice(add, backfill)).not.toMatch(/DEFAULT/i);
  });

  it('o motivo tem de combinar com a forma do movimento', () => {
    const shape = M137.slice(M137.indexOf('warehouse_bin_movements_reason_shape'));
    expect(shape).toContain("movement_type = 'entrada'");
    expect(shape).toContain("movement_type = 'saida'");
    expect(shape).toContain("movement_type = 'transferencia'");
    // Uma entrada classificada como separação somaria caixa que entrou dentro do que saiu.
    expect(shape).not.toMatch(/'entrada'[^)]*'separacao'/);
  });

  it('quem escreve classifica, e a onda reclassifica', () => {
    expect(fnBody('wms_bin_putaway')).toContain("'entrada', 'recebimento'");
    expect(fnBody('wms_bin_pick')).toContain("'saida', 'abastecimento'");
    expect(fnBody('wms_bin_transfer')).toContain("'transferencia', 'transferencia'");
    // Classificar pelo texto de p_reason deixaria a estatística depender de como o
    // operador escreveu a observação. Quem sabe que é onda é a função da onda.
    expect(fnBody('wms_pick_for_wave')).toContain("SET movement_reason = 'separacao'");
  });

  it('endereço desativado recusa ENTRAR e nunca recusa SAIR', () => {
    // Travar a saída prenderia o saldo residual dentro do endereço desativado — o
    // oposto do que desativar significa.
    expect(fnBody('wms_bin_putaway')).toContain('AND is_active');
    expect(fnBody('wms_bin_transfer')).toContain('AND is_active');
    expect(fnBody('wms_bin_pick')).not.toContain('AND is_active');
    // Na transferência a exigência é do DESTINO, nunca da origem.
    const transfer = fnBody('wms_bin_transfer');
    const guarda = transfer.slice(transfer.indexOf('AND is_active') - 200, transfer.indexOf('AND is_active') + 120);
    expect(guarda).toContain('v_to');
    expect(guarda).not.toContain('WHERE id = v_from AND is_active');
  });

  it('a reserva também não some pela porta da transferência', () => {
    // A reserva aponta para um endereço. Sem esta guarda, mover a mercadoria seria o
    // caminho aberto para esvaziar o que uma onda já prometeu.
    expect(fnBody('wms_bin_transfer')).toContain('libere a reserva antes de transferir');
  });

  it('as invariantes antigas sobrevivem à redeclaração', () => {
    for (const fn of ['wms_bin_putaway', 'wms_bin_pick', 'wms_bin_transfer']) {
      const corpo = fnBody(fn);
      expect(corpo).toContain('v_company := wms_require_operator();');
      expect(corpo).toContain('SECURITY DEFINER');
      expect(corpo).toContain("SET search_path TO 'public'");
    }
    // A idade do lote continua sem rejuvenescer.
    expect(fnBody('wms_bin_transfer')).toContain('LEAST(warehouse_bin_stock.first_stored_at, EXCLUDED.first_stored_at)');
    const putaway = fnBody('wms_bin_putaway');
    const doUpdate = putaway.slice(putaway.indexOf('ON CONFLICT (company_id, bin_id, product_id) DO UPDATE'));
    expect(doUpdate.slice(0, doUpdate.indexOf(';'))).not.toContain('first_stored_at');
    // E o pack misto continua recusado.
    for (const fn of ['wms_bin_putaway', 'wms_bin_transfer']) {
      expect(fnBody(fn)).toContain('units_per_box IS DISTINCT FROM');
    }
  });
});

// ── Ondas de separação ────────────────────────────────────────────────────────────────

const M138 = migracao('138_picking_waves');
const M139 = migracao('139_picking_waves_rpcs');

describe('138 — o domínio da onda', () => {
  it('existe e é aditiva', () => {
    expect(M138.length).toBeGreaterThan(0);
    expect(M138).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(M138).not.toMatch(/\bDROP\s+FUNCTION\b/i);
    expect(M138).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    // Não encosta no motor de saldo da Etapa 1.
    const executavel = M138.replace(/--.*/g, ' ');
    for (const proibido of ['FUNCTION public.wms_', 'ALTER TABLE warehouse_bin_stock', 'ALTER TABLE warehouse_bin_movements']) {
      expect(executavel.includes(proibido)).toBe(false);
    }
  });

  it('demanda e plano são tabelas SEPARADAS', () => {
    // Um pedido de 10 caixas vira três paradas quando o saldo está espalhado. Juntar as
    // duas obrigaria a reescrever a demanda toda vez que o alocador mudasse de ideia —
    // e aí ninguém mais sabe o que foi pedido.
    expect(M138).toContain('CREATE TABLE IF NOT EXISTS picking_wave_items');
    expect(M138).toContain('CREATE TABLE IF NOT EXISTS picking_allocations');
    const alloc = M138.slice(
      M138.indexOf('CREATE TABLE IF NOT EXISTS picking_allocations'),
      M138.indexOf('CREATE INDEX IF NOT EXISTS picking_allocations_rota_idx'),
    );
    expect(alloc).toContain('item_id');
    expect(alloc).toContain('bin_id');
    expect(alloc).toContain('reservation_id');
  });

  it('uma alocação por item e endereço', () => {
    // `wms_pick_for_wave` consome a reserva do dono pela mais antiga: duas alocações do
    // mesmo item no mesmo endereço gerariam reservas indistinguíveis, e a baixa de uma
    // consumiria a outra.
    expect(M138).toContain('CONSTRAINT picking_allocations_unique UNIQUE (item_id, bin_id)');
  });

  it('não dá para separar mais do que foi alocado', () => {
    expect(M138).toContain('CHECK (boxes_separadas <= boxes)');
  });

  it('onda encerrada tem data de encerramento, e onda aberta não tem', () => {
    expect(M138).toContain("CHECK ((status IN ('concluida','parcial','cancelada')) = (finished_at IS NOT NULL))");
  });

  it('a bipagem é ledger: chave de idempotência obrigatória e única', () => {
    const eventos = M138.slice(M138.indexOf('CREATE TABLE IF NOT EXISTS picking_scan_events'));
    expect(eventos).toContain('idempotency_key uuid NOT NULL UNIQUE');
    // A recusa também é evento: sem ela, divergência é palavra contra palavra.
    for (const motivo of ['endereco_errado', 'produto_errado', 'quantidade_divergente', 'ruptura']) {
      expect(eventos).toContain(motivo);
    }
  });

  it('escrever é só por RPC, nas quatro tabelas', () => {
    for (const t of ['picking_waves', 'picking_wave_items', 'picking_allocations', 'picking_scan_events']) {
      expect(M138).toMatch(new RegExp(`ALTER TABLE ${t}\\s+ENABLE ROW LEVEL SECURITY`));
    }
    const policies = M138.match(/CREATE POLICY \w+ ON picking_\w+\s+FOR (\w+)/g) ?? [];
    expect(policies.length).toBe(4);
    for (const policy of policies) expect(policy).toMatch(/FOR SELECT/);
    expect(M138).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE[\s\S]{0,200}FROM public, anon, authenticated/);
  });

  it('a view da rota respeita a RLS de quem pergunta', () => {
    const view = M138.slice(M138.indexOf('CREATE OR REPLACE VIEW picking_wave_route_v'));
    expect(view.slice(0, view.indexOf('AS'))).toContain('security_invoker = true');
  });
});

describe('139 — o comportamento da onda', () => {
  it('fecha a escrita que a 138 deixou aberta na view', () => {
    // Medido: o REVOKE da 138 nomeou as tabelas e esqueceu a view criada abaixo.
    expect(M139).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE\s+ON picking_wave_route_v FROM public, anon, authenticated/);
  });

  it('a chave de caminhada é rua, módulo, nível — nessa ordem', () => {
    const corpo = fnBody('wms_bin_route_key');
    expect(corpo).toContain('IMMUTABLE');
    expect(corpo).toContain("v_rua || lpad(v_modulo::text, 4, '0') || lpad(v_nivel::text, 3, '0')");
    // Código ilegível vai para o FIM, nunca para o começo: uma parada que o sistema não
    // sabe localizar não pode abrir a caminhada do operador.
    expect(corpo).toContain("RETURN 'ZZZZ'");
  });

  it('serpentina existe e vem DESLIGADA', () => {
    expect(fnBody('wms_bin_route_key')).toContain('p_serpentina boolean DEFAULT false');
    expect(fnBody('picking_wave_reserve')).toContain('p_serpentina boolean DEFAULT false');
  });

  it('o resolvedor devolve CANDIDATOS, no plural', () => {
    // Foram medidos 199 EANs repetidos entre produtos: escolher o primeiro em silêncio é
    // separar o produto errado com a bênção do sistema.
    expect(fnBody('picking_resolve_product')).toContain('candidatos');
    expect(fnBody('picking_resolve_product')).toContain('jsonb_agg');
  });

  it('o alocador segue FIFO e pula endereço bloqueado ou desativado', () => {
    const corpo = fnBody('picking_alocar_item');
    expect(corpo).toContain('ORDER BY v.first_stored_at');
    expect(corpo).toContain('NOT v.bin_blocked');
    expect(corpo).toContain('v.bin_is_active');
    // SECURITY DEFINER não herda RLS, e a view de disponibilidade é security_invoker:
    // dentro da função o usuário efetivo é o dono, que não sofre RLS.
    expect(corpo).toContain('v.company_id = v_company');
  });

  it('reservar usa o motor da Etapa 1, não um caminho paralelo', () => {
    expect(fnBody('picking_alocar_item')).toContain('wms_reserve_stock(');
    expect(fnBody('picking_wave_pick')).toContain('wms_pick_for_wave(');
    expect(fnBody('picking_wave_finish')).toContain("wms_release_reservation('onda'");
    expect(fnBody('picking_wave_cancel')).toContain("wms_release_reservation('onda'");
    // Nada de mexer no saldo por fora.
    for (const fn of ['picking_alocar_item', 'picking_wave_pick', 'picking_wave_finish', 'picking_wave_cancel']) {
      expect(fnBody(fn)).not.toContain('UPDATE warehouse_bin_stock');
      expect(fnBody(fn)).not.toContain('INSERT INTO warehouse_bin_movements');
    }
  });

  it('recusa é RETORNO, nunca exceção', () => {
    // RAISE desfaria o INSERT do evento que registra a própria recusa — o log de
    // divergência nunca chegaria ao banco, que é o motivo de ele existir.
    const corpo = fnBody('picking_wave_pick');
    for (const motivo of ['endereco_errado', 'produto_errado', 'quantidade_divergente']) {
      const trecho = corpo.slice(corpo.indexOf(`'${motivo}', p_idempotency_key`));
      const ate = trecho.slice(0, trecho.indexOf('END IF;'));
      expect(ate).toContain('RETURN jsonb_build_object');
      expect(ate).not.toContain('RAISE EXCEPTION');
    }
  });

  it('a recusa não entrega o gabarito', () => {
    // Cegueira de identidade: dizer "o esperado era X" transforma a conferência em
    // tentativa e erro.
    const corpo = fnBody('picking_wave_pick');
    expect(corpo).toContain("'O produto bipado não é o desta parada'");
    expect(corpo).not.toMatch(/mensagem[^)]*v_a\.(sku|product_id)/);
  });

  it('idempotência vem antes de qualquer escrita', () => {
    const corpo = fnBody('picking_wave_pick');
    const checagem = corpo.indexOf('FROM picking_scan_events WHERE idempotency_key');
    const primeiraEscrita = corpo.indexOf('INSERT INTO picking_scan_events');
    expect(checagem).toBeGreaterThan(-1);
    expect(primeiraEscrita).toBeGreaterThan(checagem);
  });

  it('ruptura devolve a reserva e tenta outro endereço', () => {
    const corpo = fnBody('picking_wave_pick');
    expect(corpo).toContain("wms_release_reservation_line(v_a.reservation_id, 'ruptura')");
    expect(corpo).toContain('picking_alocar_item(v_a.item_id)');
    expect(corpo).toContain('picking_resequenciar(v_a.wave_id)');
  });

  it('fechar e cancelar não deixam reserva aberta para trás', () => {
    // Saldo prometido a uma onda que acabou é saldo preso que nenhuma tela explica.
    for (const fn of ['picking_wave_finish', 'picking_wave_cancel']) {
      expect(fnBody(fn)).toContain('wms_release_reservation');
    }
  });

  it('toda RPC passa pela guarda de papel e fixa o search_path', () => {
    for (const fn of ['picking_resolve_product','picking_wave_create','picking_wave_add_item',
                      'picking_wave_remove_item','picking_wave_reserve','picking_wave_pick',
                      'picking_wave_finish','picking_wave_cancel']) {
      const corpo = fnBody(fn);
      expect(corpo).toContain('SECURITY DEFINER');
      expect(corpo).toContain("SET search_path TO 'public'");
      expect(corpo).toContain('wms_require_operator()');
    }
  });

  it('as peças internas não são RPC', () => {
    // Expor o alocador seria deixar reservar saldo sem onda que responda por ele.
    for (const fn of ['wms_bin_route_key(text, boolean)', 'picking_alocar_item(uuid)', 'picking_resequenciar(uuid, boolean)']) {
      const revoke = M139.split('\n').find(l => l.includes(`REVOKE ALL ON FUNCTION public.${fn}`)) ?? '';
      expect(revoke).toContain('FROM public, anon, authenticated;');
      expect(M139).not.toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn.replace(/[().,*+?^$|[\]\\]/g, '\\$&')}`));
    }
  });

  it('nenhuma RPC é concedida a anon', () => {
    expect(M139).not.toMatch(/GRANT[^;]*\bTO\b[^;]*\banon\b/i);
    // E todo REVOKE nomeia authenticated: revogar só de `public` não tira o privilégio
    // que o ALTER DEFAULT PRIVILEGES do Supabase concede a toda função nova.
    const revokes = M139.match(/REVOKE ALL ON FUNCTION[^;]+;/g) ?? [];
    expect(revokes.length).toBeGreaterThan(0);
    for (const revoke of revokes) expect(revoke).toContain('authenticated');
  });
});
