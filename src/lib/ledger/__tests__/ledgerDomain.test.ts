import { describe, expect, it } from 'vitest';
import {
  ADJUSTMENT_APPLIED, RESTOCK_MOVEMENT, contagemSemAjuste, mergeLedger, summarize,
  type BalanceEffect, type LedgerEntry, type LedgerSource,
} from '../ledgerDomain';

function lancamento(over: Partial<LedgerEntry> & { key: string; at: string }): LedgerEntry {
  return {
    source: 'contagem' as LedgerSource,
    effect: 'registrou' as BalanceEffect,
    title: 'Contagem física',
    detail: null,
    quantity: null,
    quantityLabel: null,
    divergence: null,
    actor: null,
    ...over,
  };
}

describe('ordenação', () => {
  it('mais recente primeiro, sem agrupar por origem', () => {
    const feed = mergeLedger([
      lancamento({ key: 'a', at: '2026-10-01T00:00:00Z', source: 'contagem' }),
      lancamento({ key: 'b', at: '2026-11-01T00:00:00Z', source: 'sincronizacao' }),
      lancamento({ key: 'c', at: '2026-10-15T00:00:00Z', source: 'devolucao' }),
    ]);
    expect(feed.map(e => e.key)).toEqual(['b', 'c', 'a']);
  });

  // Duas origens podem gravar no mesmo instante; sem desempate estável a ordem
  // passaria a depender de qual consulta respondeu primeiro.
  it('empate de data desempata pela chave, de forma estável', () => {
    const mesmo = '2026-11-01T00:00:00Z';
    const ordem = () => mergeLedger([
      lancamento({ key: 'sync:2', at: mesmo }),
      lancamento({ key: 'contagem:1', at: mesmo }),
    ]).map(e => e.key);
    expect(ordem()).toEqual(['contagem:1', 'sync:2']);
    expect(ordem()).toEqual(ordem());
  });

  it('não altera o array recebido', () => {
    const original = [
      lancamento({ key: 'a', at: '2026-10-01T00:00:00Z' }),
      lancamento({ key: 'b', at: '2026-11-01T00:00:00Z' }),
    ];
    mergeLedger(original);
    expect(original.map(e => e.key)).toEqual(['a', 'b']);
  });
});

describe('resumo', () => {
  const entradas = [
    lancamento({ key: 'c1', at: '2026-10-01T00:00:00Z', source: 'contagem', effect: 'registrou' }),
    lancamento({ key: 's1', at: '2026-10-05T00:00:00Z', source: 'sincronizacao', effect: 'moveu' }),
    lancamento({ key: 's2', at: '2026-10-07T00:00:00Z', source: 'sincronizacao', effect: 'nao_aplicado' }),
    lancamento({ key: 'i1', at: '2026-10-09T00:00:00Z', source: 'inventario', effect: 'registrou' }),
  ];

  it('conta cada efeito separadamente', () => {
    const r = summarize(entradas);
    expect(r).toMatchObject({ total: 4, moveram: 1, registraram: 2, naoAplicados: 1 });
  });

  // "Último movimento" é o último que MEXEU — uma sincronização ignorada é mais
  // recente e não moveu nada; apontá-la seria dizer que o saldo mudou quando não mudou.
  it('o último movimento ignora o que não foi aplicado', () => {
    expect(summarize(entradas).ultimoMovimento?.key).toBe('s1');
  });

  it('a última contagem vale tanto para contagem física quanto para inventário', () => {
    expect(summarize(entradas).ultimaContagem?.key).toBe('i1');
  });

  it('sem nada contado nem movido, os dois ficam nulos', () => {
    const r = summarize([lancamento({ key: 'e1', at: '2026-10-01T00:00:00Z', source: 'endereco' })]);
    expect(r.ultimoMovimento).toBeNull();
    expect(r.ultimaContagem).toBeNull();
  });
});

describe('divergência apurada que nunca virou ajuste', () => {
  const contagem = (at: string, divergence: number) =>
    lancamento({ key: `c:${at}`, at, source: 'contagem', effect: 'registrou', divergence });
  const ajuste = (at: string, effect: BalanceEffect = 'moveu') =>
    lancamento({ key: `a:${at}`, at, source: 'ajuste', effect });

  it('acusa quando a contagem achou diferença e nenhum ajuste veio depois', () => {
    expect(contagemSemAjuste([contagem('2026-10-01T00:00:00Z', -3)])?.divergence).toBe(-3);
  });

  it('cala quando o ajuste é posterior à contagem', () => {
    expect(contagemSemAjuste([
      contagem('2026-10-01T00:00:00Z', -3),
      ajuste('2026-10-02T00:00:00Z'),
    ])).toBeNull();
  });

  // Ajustar e contar de novo depois é o fluxo correto, não um alerta resolvido: a
  // contagem nova é que manda.
  it('volta a acusar quando há contagem nova depois do ajuste', () => {
    expect(contagemSemAjuste([
      contagem('2026-10-01T00:00:00Z', -3),
      ajuste('2026-10-02T00:00:00Z'),
      contagem('2026-10-03T00:00:00Z', -5),
    ])?.divergence).toBe(-5);
  });

  it('um ajuste que não foi aplicado não encerra a pendência', () => {
    expect(contagemSemAjuste([
      contagem('2026-10-01T00:00:00Z', -3),
      ajuste('2026-10-02T00:00:00Z', 'nao_aplicado'),
    ])?.divergence).toBe(-3);
  });

  it('contagem sem diferença não acusa nada', () => {
    expect(contagemSemAjuste([contagem('2026-10-01T00:00:00Z', 0)])).toBeNull();
    expect(contagemSemAjuste([lancamento({ key: 'c', at: '2026-10-01T00:00:00Z' })])).toBeNull();
  });
});

describe('vocabulário vindo do banco', () => {
  // Estes dois valores decidem se um lançamento conta como alteração de saldo. Vêm de
  // CHECK constraints (migrations 083 e 045); mudá-los aqui sem mudar lá faria a tela
  // classificar movimento como registro, em silêncio.
  it('o destino que devolve ao estoque vendável', () => {
    expect(RESTOCK_MOVEMENT).toBe('restock');
  });

  it('as situações de ajuste que já alteraram o estoque do ERP', () => {
    expect([...ADJUSTMENT_APPLIED].sort()).toEqual(['confirmed', 'sent']);
  });
});
