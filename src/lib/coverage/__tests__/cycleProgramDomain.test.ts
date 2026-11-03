import { describe, expect, it } from 'vitest';
import {
  CAPACITY_MAX, DEFAULT_CYCLE_CONFIG, normalizeConfig, planDailyBatch, programStatus,
  type CycleProgramConfig,
} from '../cycleProgramDomain';
import type { AbcClass, CoverageItem } from '../coverageDomain';

const NOW = new Date('2026-11-03T12:00:00.000Z');

function diasAtras(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}

let seq = 0;
function item(over: Partial<CoverageItem> & { productId?: string } = {}): CoverageItem {
  seq += 1;
  const id = over.productId ?? `p${seq}`;
  return {
    productId: id,
    sku: id,
    name: `Produto ${id}`,
    location: null,
    abc: null as AbcClass,
    lastCountedAt: null,
    value: 0,
    ...over,
  };
}

const config = (over: Partial<CycleProgramConfig> = {}): CycleProgramConfig => ({
  ...DEFAULT_CYCLE_CONFIG,
  ...over,
});

describe('normalizeConfig', () => {
  it('sem nada gravado devolve os padrões', () => {
    expect(normalizeConfig(null)).toEqual(DEFAULT_CYCLE_CONFIG);
    expect(normalizeConfig(undefined)).toEqual(DEFAULT_CYCLE_CONFIG);
  });

  it('completa a classe que faltar na linha gravada', () => {
    const resultado = normalizeConfig({ cadenceDays: { A: 15 } as never });
    expect(resultado.cadenceDays).toEqual({ A: 15, B: 90, C: 180, sem: 180 });
  });

  // Cadência zero faria a classe inteira aparecer como vencida para sempre, e dividir por
  // zero no ratio devolveria Infinity para todo mundo — o lote viraria ruído.
  it('cadência zero ou negativa sobe para o mínimo de 1 dia', () => {
    const resultado = normalizeConfig({ cadenceDays: { A: 0, B: -30, C: 180, sem: 180 } });
    expect(resultado.cadenceDays.A).toBe(1);
    expect(resultado.cadenceDays.B).toBe(1);
  });

  it('capacidade fora da faixa é presa nos limites', () => {
    expect(normalizeConfig({ dailyCapacity: 0 }).dailyCapacity).toBe(1);
    expect(normalizeConfig({ dailyCapacity: -5 }).dailyCapacity).toBe(1);
    expect(normalizeConfig({ dailyCapacity: 99999 }).dailyCapacity).toBe(CAPACITY_MAX);
  });

  it('valores quebrados são arredondados, não truncados silenciosamente', () => {
    expect(normalizeConfig({ dailyCapacity: 29.6 }).dailyCapacity).toBe(30);
  });

  it('NaN não contamina a configuração', () => {
    expect(normalizeConfig({ dailyCapacity: Number.NaN }).dailyCapacity).toBe(30);
    expect(normalizeConfig({ cadenceDays: { A: Number.NaN } as never }).cadenceDays.A).toBe(30);
  });

  it('enabled só é verdadeiro quando é exatamente true', () => {
    expect(normalizeConfig({ enabled: true }).enabled).toBe(true);
    expect(normalizeConfig({ enabled: undefined }).enabled).toBe(false);
    expect(normalizeConfig({ enabled: 1 as never }).enabled).toBe(false);
  });
});

describe('planDailyBatch — faixas', () => {
  it('lote vazio quando não há nada vencido nem pendente', () => {
    const itens = [item({ abc: 'A', lastCountedAt: diasAtras(5) })];
    const lote = planDailyBatch(itens, config(), NOW);
    expect(lote.entries).toHaveLength(0);
    expect(lote.dueTotal).toBe(0);
    expect(lote.backlogTotal).toBe(0);
  });

  it('no dia exato da cadência o item ainda está em dia', () => {
    const itens = [item({ abc: 'A', lastCountedAt: diasAtras(30) })];
    expect(planDailyBatch(itens, config(), NOW).entries).toHaveLength(0);
  });

  it('um dia depois da cadência o item entra no lote', () => {
    const itens = [item({ abc: 'A', lastCountedAt: diasAtras(31) })];
    const lote = planDailyBatch(itens, config(), NOW);
    expect(lote.entries).toHaveLength(1);
    expect(lote.entries[0].origin).toBe('vencido');
  });

  // O coração do módulo: sem a reserva, os nunca contados tomariam o lote inteiro e o item
  // que acabou de ser ciclado nunca voltaria.
  it('vencido entra antes de nunca contado, mesmo valendo muito menos', () => {
    const itens = [
      item({ productId: 'barato', abc: 'A', lastCountedAt: diasAtras(31), value: 1 }),
      item({ productId: 'caro', abc: 'A', lastCountedAt: null, value: 1_000_000 }),
    ];
    const lote = planDailyBatch(itens, config({ dailyCapacity: 1 }), NOW);
    expect(lote.entries.map(e => e.productId)).toEqual(['barato']);
    expect(lote.backlogTaken).toBe(0);
  });

  it('a sobra da capacidade vai para o backlog', () => {
    const itens = [
      item({ abc: 'A', lastCountedAt: diasAtras(31) }),
      item({ productId: 'n1', value: 500 }),
      item({ productId: 'n2', value: 100 }),
    ];
    const lote = planDailyBatch(itens, config({ dailyCapacity: 3 }), NOW);
    expect(lote.dueTaken).toBe(1);
    expect(lote.backlogTaken).toBe(2);
    expect(lote.entries.slice(1).map(e => e.productId)).toEqual(['n1', 'n2']);
  });

  it('vencidos acima da capacidade empurram o backlog para fora do dia', () => {
    const itens = [
      ...Array.from({ length: 5 }, (_, i) =>
        item({ productId: `v${i}`, abc: 'A', lastCountedAt: diasAtras(40 + i) })),
      item({ productId: 'nunca', value: 999 }),
    ];
    const lote = planDailyBatch(itens, config({ dailyCapacity: 3 }), NOW);
    expect(lote.entries).toHaveLength(3);
    expect(lote.entries.every(e => e.origin === 'vencido')).toBe(true);
    expect(lote.dueTotal).toBe(5);
    expect(lote.backlogTotal).toBe(1);
    expect(lote.backlogTaken).toBe(0);
  });
});

describe('planDailyBatch — ordenação', () => {
  it('vencidos saem por atraso relativo à própria cadência, não por dias absolutos', () => {
    const itens = [
      item({ productId: 'c-parado', abc: 'C', lastCountedAt: diasAtras(200) }), // 200/180 = 1,11
      item({ productId: 'a-parado', abc: 'A', lastCountedAt: diasAtras(60) }),  //  60/30  = 2,00
    ];
    const lote = planDailyBatch(itens, config(), NOW);
    expect(lote.entries.map(e => e.productId)).toEqual(['a-parado', 'c-parado']);
  });

  it('empate de atraso desempata por valor parado', () => {
    const itens = [
      item({ productId: 'pobre', abc: 'A', lastCountedAt: diasAtras(60), value: 10 }),
      item({ productId: 'rico', abc: 'A', lastCountedAt: diasAtras(60), value: 9_000 }),
    ];
    const lote = planDailyBatch(itens, config(), NOW);
    expect(lote.entries.map(e => e.productId)).toEqual(['rico', 'pobre']);
  });

  it('backlog sai do mais caro para o mais barato', () => {
    const itens = [
      item({ productId: 'medio', value: 500 }),
      item({ productId: 'caro', value: 5_000 }),
      item({ productId: 'barato', value: 5 }),
    ];
    const lote = planDailyBatch(itens, config(), NOW);
    expect(lote.entries.map(e => e.productId)).toEqual(['caro', 'medio', 'barato']);
  });

  // Sem desempate estável, duas aberturas da tela no mesmo dia poderiam listar SKUs
  // diferentes para a mesma equipe.
  it('empate total desempata por SKU e o lote é estável entre chamadas', () => {
    const itens = [item({ productId: 'z-sku' }), item({ productId: 'a-sku' })];
    const primeiro = planDailyBatch(itens, config(), NOW);
    const segundo = planDailyBatch([...itens].reverse(), config(), NOW);
    expect(primeiro.entries.map(e => e.productId)).toEqual(['a-sku', 'z-sku']);
    expect(segundo.entries.map(e => e.productId)).toEqual(['a-sku', 'z-sku']);
  });

  it('não altera o array recebido', () => {
    const itens = [item({ productId: 'b', value: 1 }), item({ productId: 'a', value: 9 })];
    planDailyBatch(itens, config(), NOW);
    expect(itens.map(i => i.productId)).toEqual(['b', 'a']);
  });
});

describe('planDailyBatch — cadência por classe', () => {
  it('a mesma data é vencida para A e em dia para C', () => {
    const quando = diasAtras(45);
    const comoA = planDailyBatch([item({ abc: 'A', lastCountedAt: quando })], config(), NOW);
    const comoC = planDailyBatch([item({ abc: 'C', lastCountedAt: quando })], config(), NOW);
    expect(comoA.dueTotal).toBe(1);
    expect(comoC.dueTotal).toBe(0);
  });

  it('produto sem classe usa a cadência da faixa "sem", configurável à parte de C', () => {
    const cfg = config({ cadenceDays: { A: 30, B: 90, C: 180, sem: 7 } });
    const lote = planDailyBatch([item({ abc: null, lastCountedAt: diasAtras(10) })], cfg, NOW);
    expect(lote.dueTotal).toBe(1);
    expect(lote.entries[0].cadenceDays).toBe(7);
    expect(lote.entries[0].bucket).toBe('sem');
  });

  it('a cadência gravada manda, não o padrão', () => {
    const cfg = config({ cadenceDays: { A: 365, B: 90, C: 180, sem: 180 } });
    const lote = planDailyBatch([item({ abc: 'A', lastCountedAt: diasAtras(100) })], cfg, NOW);
    expect(lote.dueTotal).toBe(0);
  });
});

describe('planDailyBatch — projeção do backlog', () => {
  it('sem backlog o prazo é zero, não nulo', () => {
    const lote = planDailyBatch([item({ abc: 'A', lastCountedAt: diasAtras(31) })], config(), NOW);
    expect(lote.backlogDaysToClear).toBe(0);
  });

  it('calcula os dias pela sobra de capacidade, não pela capacidade cheia', () => {
    const itens = [
      ...Array.from({ length: 10 }, (_, i) =>
        item({ productId: `v${i}`, abc: 'A', lastCountedAt: diasAtras(40) })),
      ...Array.from({ length: 100 }, (_, i) => item({ productId: `n${i}` })),
    ];
    // 30 de capacidade − 10 vencidos = 20 por dia para o backlog -> 100/20 = 5 dias.
    expect(planDailyBatch(itens, config({ dailyCapacity: 30 }), NOW).backlogDaysToClear).toBe(5);
  });

  it('arredonda para cima: sobra de item é mais um dia', () => {
    const itens = Array.from({ length: 101 }, (_, i) => item({ productId: `n${i}` }));
    expect(planDailyBatch(itens, config({ dailyCapacity: 10 }), NOW).backlogDaysToClear).toBe(11);
  });

  // Prazo nenhum seria honesto aqui: a fila não anda.
  it('backlog parado atrás dos vencidos devolve prazo nulo', () => {
    const itens = [
      ...Array.from({ length: 50 }, (_, i) =>
        item({ productId: `v${i}`, abc: 'A', lastCountedAt: diasAtras(40) })),
      item({ productId: 'n1' }),
    ];
    expect(planDailyBatch(itens, config({ dailyCapacity: 10 }), NOW).backlogDaysToClear).toBeNull();
  });
});

describe('programStatus', () => {
  it('separa em dia, vencidos e nunca contados', () => {
    const itens = [
      item({ abc: 'A', lastCountedAt: diasAtras(5) }),
      item({ abc: 'A', lastCountedAt: diasAtras(31) }),
      item({ abc: 'B', lastCountedAt: diasAtras(100) }),
      item({ abc: 'C', lastCountedAt: null }),
    ];
    expect(programStatus(itens, config(), NOW)).toEqual({
      total: 4, emDia: 1, vencidos: 2, nunca: 1,
    });
  });

  it('catálogo vazio não quebra', () => {
    expect(programStatus([], config(), NOW)).toEqual({ total: 0, emDia: 0, vencidos: 0, nunca: 0 });
  });

  it('data de contagem no futuro conta como em dia, não como vencida', () => {
    const futuro = new Date(NOW.getTime() + 5 * 86_400_000).toISOString();
    const status = programStatus([item({ abc: 'A', lastCountedAt: futuro })], config(), NOW);
    expect(status).toEqual({ total: 1, emDia: 1, vencidos: 0, nunca: 0 });
  });
});
