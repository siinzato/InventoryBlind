// A RPC de endereçamento vive no banco e as regras que ela delega vivem noutra
// migration. O compilador não liga nada disso: se `nfe_putaway_item` parar de chamar
// `wms_bin_putaway` e passar a inserir direto, as três guardas do Pulmão — endereço
// bloqueado, capacidade e pack divergente — somem sem nenhum erro aparecer.
//
// Mesmo mecanismo de wmsMigrationGuards.test.ts: lê o SQL cru e cobra o contrato.
// Asserções sempre em pedaço de UMA linha, porque o arquivo pode estar com CRLF.

import { describe, expect, it } from 'vitest';

// Curinga no timestamp: o Supabase versiona pelo timestamp do nome, e ele muda quando a
// migration é aplicada pelo servidor. O que identifica a migration é o `124_...`.
const RAW = import.meta.glob('/supabase/migrations/*_124_nfe_putaway.sql', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const SQL = Object.values(RAW)[0] ?? '';

describe('a migration existe e é aditiva', () => {
  it('foi encontrada', () => {
    expect(SQL.length).toBeGreaterThan(0);
  });

  it('não apaga nem altera o que já existe', () => {
    expect(SQL).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i);
    // Nenhum ALTER em tabela de terceiros: a fatia só acrescenta a ligação.
    expect(SQL).not.toMatch(/ALTER TABLE (public\.)?(nfe_invoice_items|nfe_invoices|products|warehouse_)/i);
  });
});

describe('delega as guardas em vez de reescrevê-las', () => {
  it('chama wms_bin_putaway', () => {
    expect(SQL).toContain('wms_bin_putaway(p_bin_code, v_item.product_id, p_boxes, p_units_per_box, v_reason)');
  });

  // Se escrevesse direto nestas duas, estaria contornando capacidade, bloqueio e pack.
  it('não escreve direto no estoque nem no movimento do Pulmão', () => {
    expect(SQL).not.toMatch(/INSERT INTO warehouse_bin_stock/i);
    expect(SQL).not.toMatch(/INSERT INTO warehouse_bin_movements/i);
  });

  // Procura ATRIBUIÇÃO, não a palavra: o cabeçalho da migration cita
  // `products.stock_quantity` justamente para documentar que não a toca.
  it('não mexe no saldo do catálogo — endereçar diz onde, não quanto', () => {
    expect(SQL).not.toMatch(/UPDATE +products/i);
    expect(SQL).not.toMatch(/stock_quantity\s*=/);
  });
});

describe('as regras que são da nota', () => {
  // Endereçar pelo esperado colocaria no endereço uma caixa que não chegou.
  it('usa a quantidade conferida, nunca a esperada', () => {
    expect(SQL).toContain('v_item.physical_quantity IS NULL');
    expect(SQL).not.toContain('v_item.expected_quantity');
  });

  it('exige conferência finalizada', () => {
    expect(SQL).toContain("v_invoice.status NOT IN ('completed', 'with_divergences')");
  });

  it('exige item vinculado a produto', () => {
    expect(SQL).toContain('v_item.product_id IS NULL');
  });

  it('recusa endereçar mais do que foi conferido', () => {
    expect(SQL).toContain('v_ja + v_pedido > v_item.physical_quantity');
  });

  it('recusa nota arquivada', () => {
    expect(SQL).toContain('v_invoice.deleted_at IS NOT NULL');
  });
});

describe('endereçamento parcial e rastreio', () => {
  // Um item de 120 unidades pode ir para três endereços: unicidade por item
  // quebraria o caso normal.
  it('não há unicidade por item', () => {
    expect(SQL).not.toMatch(/UNIQUE *\([^)]*item_id/i);
  });

  it('o progresso é a soma das unidades já endereçadas', () => {
    expect(SQL).toContain('coalesce(sum(units), 0)');
  });

  it('o motivo do movimento carrega a nota de origem', () => {
    expect(SQL).toContain("'Recebimento NF-e '");
  });
});

describe('escrita só pela RPC', () => {
  it('a tabela tem policy de SELECT e nenhuma de escrita', () => {
    expect(SQL).toContain('nfe_putaway_assignments_select');
    expect(SQL).not.toMatch(/nfe_putaway_assignments_insert/);
    expect(SQL).not.toMatch(/nfe_putaway_assignments_update/);
    expect(SQL).not.toMatch(/nfe_putaway_assignments_delete/);
  });

  it('a RPC é executável por quem está autenticado, e não por anônimo', () => {
    expect(SQL).toContain('REVOKE ALL ON FUNCTION public.nfe_putaway_item(uuid, text, integer, integer) FROM PUBLIC, anon;');
    expect(SQL).toContain('GRANT EXECUTE ON FUNCTION public.nfe_putaway_item(uuid, text, integer, integer) TO authenticated;');
  });
});
