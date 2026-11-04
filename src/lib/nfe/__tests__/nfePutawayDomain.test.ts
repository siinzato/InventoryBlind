import { describe, expect, it } from 'vitest';
import {
  boxesThatFit, buildLines, suggestPack, summarizePutaway, validatePlacement,
  type PutawayAssignment,
} from '../nfePutawayDomain';
import type { NfeInvoiceItem } from '../nfeTypes';

let seq = 0;
function item(over: Partial<NfeInvoiceItem> = {}): NfeInvoiceItem {
  seq += 1;
  return {
    id: `i${seq}`,
    invoice_id: 'nf1',
    company_id: 'c1',
    line_number: seq,
    nfe_code: `COD${seq}`,
    description: `Item ${seq}`,
    unit: 'UN',
    expected_quantity: 100,
    unit_value: null,
    total_value: null,
    nfe_ean: null,
    nfe_ean_normalized: null,
    product_id: `p${seq}`,
    link_method: 'ean',
    physical_quantity: 100,
    result_status: 'ok',
    snapshot_product_name: `Produto ${seq}`,
    snapshot_sku: `SKU${seq}`,
    snapshot_ean: null,
    created_at: '2026-11-04T10:00:00Z',
    updated_at: '2026-11-04T10:00:00Z',
    ...over,
  } as NfeInvoiceItem;
}

function atrib(itemId: string, boxes: number, unitsPerBox: number, createdAt: string): PutawayAssignment {
  return {
    id: `a-${itemId}-${createdAt}`, itemId, binCode: 'PP-A01-N1',
    boxes, unitsPerBox, units: boxes * unitsPerBox, createdAt,
    // Nulos: a empresa-padrão dos testes não liga a chave de lote/validade.
    lotNumber: null, expiryDate: null,
  };
}

describe('progresso por item', () => {
  it('sem endereçamento, tudo pendente', () => {
    const [linha] = buildLines([item({ physical_quantity: 50 })], []);
    expect(linha).toMatchObject({ conferred: 50, placed: 0, remaining: 50, status: 'pendente' });
  });

  // Endereçar em partes é o caso normal: um item pode ir para vários endereços.
  it('soma os endereçamentos e vira parcial', () => {
    const it1 = item({ physical_quantity: 120 });
    const [linha] = buildLines([it1], [
      atrib(it1.id, 2, 12, '2026-11-04T11:00:00Z'),
      atrib(it1.id, 3, 12, '2026-11-04T12:00:00Z'),
    ]);
    expect(linha).toMatchObject({ placed: 60, remaining: 60, status: 'parcial' });
  });

  it('completo quando a soma alcança o conferido', () => {
    const it1 = item({ physical_quantity: 24 });
    const [linha] = buildLines([it1], [atrib(it1.id, 2, 12, '2026-11-04T11:00:00Z')]);
    expect(linha).toMatchObject({ placed: 24, remaining: 0, status: 'completo' });
  });

  // A quantidade que vale é a CONFERIDA, nunca a esperada pela nota: endereçar pelo
  // que a nota prometia colocaria no endereço uma caixa que não chegou.
  it('usa a quantidade conferida, não a esperada', () => {
    const [linha] = buildLines([item({ expected_quantity: 100, physical_quantity: 40 })], []);
    expect(linha.conferred).toBe(40);
    expect(linha.remaining).toBe(40);
  });

  it('item sem produto vinculado não é endereçável', () => {
    const [linha] = buildLines([item({ product_id: null })], []);
    expect(linha.status).toBe('bloqueado');
    expect(linha.blockedReason).toMatch(/produto do catálogo/);
  });

  // Linha conferida com zero continua aparecendo: omiti-la faria a nota parecer
  // menor do que é.
  it('conferido zero fica na lista, marcado como não endereçável', () => {
    const [linha] = buildLines([item({ physical_quantity: 0 })], []);
    expect(linha.status).toBe('bloqueado');
    expect(linha.blockedReason).toMatch(/Nada foi conferido/);
  });

  it('não contamina um item com o endereçamento de outro', () => {
    const a = item({ physical_quantity: 10 });
    const b = item({ physical_quantity: 10 });
    const linhas = buildLines([a, b], [atrib(a.id, 1, 10, '2026-11-04T11:00:00Z')]);
    expect(linhas[0].placed).toBe(10);
    expect(linhas[1].placed).toBe(0);
  });
});

describe('resumo do recebimento', () => {
  it('conta cada situação e soma o que falta', () => {
    const a = item({ physical_quantity: 10 });
    const b = item({ physical_quantity: 10 });
    const c = item({ physical_quantity: 10 });
    const d = item({ product_id: null, physical_quantity: 99 });
    const linhas = buildLines([a, b, c, d], [
      atrib(a.id, 1, 10, '2026-11-04T11:00:00Z'),
      atrib(b.id, 1, 4, '2026-11-04T11:00:00Z'),
    ]);
    expect(summarizePutaway(linhas)).toMatchObject({
      total: 4, completos: 1, parciais: 1, pendentes: 1, bloqueados: 1, unidadesRestantes: 16,
    });
  });

  // As 99 unidades do item bloqueado não são trabalho pendente — não há onde
  // endereçá-las. Somá-las faria o resumo contradizer o próprio "concluído".
  it('unidades de item bloqueado não entram no que falta', () => {
    const a = item({ physical_quantity: 10 });
    const d = item({ product_id: null, physical_quantity: 99 });
    const linhas = buildLines([a, d], [atrib(a.id, 1, 10, '2026-11-04T11:00:00Z')]);
    const r = summarizePutaway(linhas);
    expect(r.unidadesRestantes).toBe(0);
    expect(r.concluido).toBe(true);
  });

  // Item bloqueado não tem o que endereçar; exigir o impossível deixaria todo
  // recebimento eternamente em aberto.
  it('item bloqueado não impede concluir', () => {
    const a = item({ physical_quantity: 10 });
    const d = item({ product_id: null });
    const linhas = buildLines([a, d], [atrib(a.id, 1, 10, '2026-11-04T11:00:00Z')]);
    expect(summarizePutaway(linhas).concluido).toBe(true);
  });

  it('não conclui enquanto houver parcial', () => {
    const a = item({ physical_quantity: 10 });
    const linhas = buildLines([a], [atrib(a.id, 1, 4, '2026-11-04T11:00:00Z')]);
    expect(summarizePutaway(linhas).concluido).toBe(false);
  });
});

describe('validação antes de chamar o banco', () => {
  const linha = () => buildLines([item({ physical_quantity: 50 })], [])[0];

  it('aceita uma colocação que cabe', () => {
    expect(validatePlacement(linha(), 4, 12)).toBeNull();
  });

  it('recusa passar do que foi conferido, dizendo quanto falta', () => {
    expect(validatePlacement(linha(), 5, 12)).toMatch(/faltam apenas 50/);
  });

  it('recusa zero, negativo e fracionado', () => {
    expect(validatePlacement(linha(), 0, 12)).toMatch(/quantas caixas/);
    expect(validatePlacement(linha(), 2, 0)).toMatch(/unidades por caixa/);
    expect(validatePlacement(linha(), 1.5, 12)).toMatch(/inteiros/);
    expect(validatePlacement(linha(), Number.NaN, 12)).toMatch(/quantas caixas/);
  });

  it('item bloqueado recusa antes de olhar os números', () => {
    const bloqueada = buildLines([item({ product_id: null })], [])[0];
    expect(validatePlacement(bloqueada, 1, 1)).toMatch(/produto do catálogo/);
  });
});

describe('sugestão de pack', () => {
  // O pack já usado NESTE item vence: o operador está dividindo a mesma mercadoria.
  it('prefere o pack já usado no próprio item', () => {
    const it1 = item({ physical_quantity: 120 });
    const linha = buildLines([it1], [atrib(it1.id, 1, 6, '2026-11-04T11:00:00Z')])[0];
    expect(suggestPack(linha, 24)).toBe(6);
  });

  it('sem histórico no item, usa o último pack conhecido do produto', () => {
    expect(suggestPack(buildLines([item()], [])[0], 24)).toBe(24);
  });

  // Nunca inventa divisão redonda: 120 unidades não significam 10 caixas de 12.
  it('sem nada conhecido, trata como solto', () => {
    expect(suggestPack(buildLines([item()], [])[0], null)).toBe(1);
  });

  it('caixas inteiras que cabem no que falta', () => {
    const linha = buildLines([item({ physical_quantity: 50 })], [])[0];
    expect(boxesThatFit(linha, 12)).toBe(4);
    expect(boxesThatFit(linha, 60)).toBe(0);
    expect(boxesThatFit(linha, 0)).toBe(0);
  });
});
