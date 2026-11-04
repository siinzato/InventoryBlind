// A chave de lote/validade só vale se for cobrada no BANCO. Na tela ela é uma
// sugestão: bastaria um cliente de API, um teste ou uma tela desatualizada para
// gravar dado que a empresa decidiu não ter — e aí a promessa de "desligado não
// deixa resíduo" estaria quebrada sem ninguém perceber.
//
// Estes testes travam isso lendo o SQL cru. Asserções sempre em pedaço de UMA
// linha, porque o arquivo pode estar com CRLF no disco.

import { describe, expect, it } from 'vitest';

// Curinga no timestamp: o Supabase versiona pelo timestamp do nome, e ele muda
// quando a migration é aplicada pelo servidor. O que identifica é o `125_...`.
const RAW = import.meta.glob('/supabase/migrations/*_125_lot_expiry_control.sql', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const SQL = Object.values(RAW)[0] ?? '';

describe('a migration existe e nasce desligada', () => {
  it('foi encontrada', () => {
    expect(SQL.length).toBeGreaterThan(0);
  });

  // Uma atualização não pode acrescentar campo obrigatório ao recebimento de
  // ninguém. Quem não usa não vê.
  it('as duas chaves nascem desligadas', () => {
    expect(SQL).toContain('lot_enabled    boolean NOT NULL DEFAULT false');
    expect(SQL).toContain('expiry_enabled boolean NOT NULL DEFAULT false');
  });

  it('são duas chaves independentes, não uma', () => {
    expect(SQL).toMatch(/lot_enabled/);
    expect(SQL).toMatch(/expiry_enabled/);
  });
});

describe('a chave é cobrada no banco', () => {
  it('a RPC recusa lote de empresa que não ligou', () => {
    expect(SQL).toContain('O controle de lote não está ligado para esta empresa');
    expect(SQL).toContain('IF v_lot IS NOT NULL AND NOT v_lot_on THEN');
  });

  it('a RPC recusa validade de empresa que não ligou', () => {
    expect(SQL).toContain('O controle de validade não está ligado para esta empresa');
    expect(SQL).toContain('IF p_expiry_date IS NOT NULL AND NOT v_expiry_on THEN');
  });

  // Empresa sem linha de configuração tem de cair em "desligado", não em erro
  // nem em "ligado". O LEFT JOIN com coalesce é o que garante isso.
  it('empresa sem configuração conta como desligada', () => {
    expect(SQL).toContain('coalesce(s.lot_enabled, false), coalesce(s.expiry_enabled, false)');
    expect(SQL).toContain('LEFT JOIN lot_control_settings s');
  });
});

describe('a troca de assinatura da RPC', () => {
  // `CREATE OR REPLACE` com parâmetros novos criaria uma SOBRECARGA: duas funções
  // de mesmo nome, e o PostgREST escolheria qualquer uma conforme o corpo da
  // chamada. A de 4 argumentos precisa morrer.
  it('derruba a versão de 4 argumentos antes de criar a de 6', () => {
    const drop = SQL.indexOf('DROP FUNCTION IF EXISTS public.nfe_putaway_item(uuid, text, integer, integer);');
    const create = SQL.indexOf('CREATE OR REPLACE FUNCTION public.nfe_putaway_item(');
    expect(drop).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(drop);
  });

  it('a nova assinatura tem os dois parâmetros opcionais', () => {
    expect(SQL).toContain('p_lot_number    text DEFAULT NULL');
    expect(SQL).toContain('p_expiry_date   date DEFAULT NULL');
  });

  it('as permissões acompanham a assinatura nova', () => {
    expect(SQL).toContain('REVOKE ALL ON FUNCTION public.nfe_putaway_item(uuid, text, integer, integer, text, date) FROM PUBLIC, anon;');
    expect(SQL).toContain('GRANT EXECUTE ON FUNCTION public.nfe_putaway_item(uuid, text, integer, integer, text, date) TO authenticated;');
  });

  // Tudo o que a 124 garantia continua garantido: a 125 reescreve a função
  // inteira, então as guardas antigas precisam ter vindo junto.
  it('preserva as guardas da 124', () => {
    expect(SQL).toContain("v_invoice.status NOT IN ('completed', 'with_divergences')");
    expect(SQL).toContain('v_ja + v_pedido > v_item.physical_quantity');
    expect(SQL).toContain('wms_bin_putaway(p_bin_code, v_item.product_id, p_boxes, p_units_per_box, v_reason)');
    expect(SQL).not.toMatch(/INSERT INTO warehouse_bin_stock/i);
    expect(SQL).not.toMatch(/stock_quantity\s*=/);
  });
});

describe('o que é guardado', () => {
  it('lote e validade entram no registro de endereçamento', () => {
    expect(SQL).toContain('ADD COLUMN IF NOT EXISTS lot_number  text');
    expect(SQL).toContain('ADD COLUMN IF NOT EXISTS expiry_date date');
  });

  // Lote em branco gravaria um lote que não existe e que apareceria depois nas
  // buscas como se fosse um.
  it('lote em branco vira nulo', () => {
    expect(SQL).toContain("nullif(btrim(coalesce(p_lot_number, '')), '')");
  });

  it('é aditiva no resto', () => {
    expect(SQL).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i);
  });
});
