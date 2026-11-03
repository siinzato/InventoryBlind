import { describe, expect, it } from 'vitest';
import {
  breakdownByClass, cadenceFor, coverageWithin, daysSince, mostOverdue, resolveBalance, statusFor,
  type CoverageItem,
} from '../coverageDomain';

const NOW = new Date('2026-11-03T12:00:00.000Z');

function item(over: Partial<CoverageItem> & { productId: string }): CoverageItem {
  return {
    sku: over.productId,
    name: `Produto ${over.productId}`,
    location: null,
    abc: null,
    lastCountedAt: null,
    value: 0,
    ...over,
  };
}

/** Data a exatamente N dias de NOW. */
const diasAtras = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe('daysSince', () => {
  it('conta dias inteiros desde a contagem', () => {
    expect(daysSince(diasAtras(45), NOW)).toBe(45);
  });

  it('devolve null para SKU nunca contado', () => {
    expect(daysSince(null, NOW)).toBeNull();
  });

  it('devolve null para data inválida em vez de NaN', () => {
    expect(daysSince('nao-e-data', NOW)).toBeNull();
  });

  it('trata contagem com data futura como hoje, nunca como negativo', () => {
    expect(daysSince(diasAtras(-3), NOW)).toBe(0);
  });
});

describe('cadenceFor', () => {
  it('usa cadência mais curta para classe A', () => {
    expect(cadenceFor('A')).toBeLessThan(cadenceFor('B'));
    expect(cadenceFor('B')).toBeLessThan(cadenceFor('C'));
  });

  it('trata produto sem classe com a cadência mais folgada', () => {
    expect(cadenceFor(null)).toBe(cadenceFor('C'));
  });
});

describe('statusFor', () => {
  it('marca em dia quem está dentro da cadência da classe', () => {
    expect(statusFor(diasAtras(20), 'A', NOW)).toBe('em_dia');
  });

  it('marca atrasado quem passou da cadência da própria classe', () => {
    expect(statusFor(diasAtras(45), 'A', NOW)).toBe('atrasado');
  });

  it('a mesma data é em dia para C e atrasada para A', () => {
    const data = diasAtras(45);
    expect(statusFor(data, 'C', NOW)).toBe('em_dia');
    expect(statusFor(data, 'A', NOW)).toBe('atrasado');
  });

  it('o dia exato da cadência ainda é em dia', () => {
    expect(statusFor(diasAtras(30), 'A', NOW)).toBe('em_dia');
    expect(statusFor(diasAtras(31), 'A', NOW)).toBe('atrasado');
  });

  it('nunca contado não é apenas atrasado', () => {
    expect(statusFor(null, 'A', NOW)).toBe('nunca');
  });
});

describe('coverageWithin', () => {
  const itens = [
    item({ productId: 'a', lastCountedAt: diasAtras(10), value: 1000 }),
    item({ productId: 'b', lastCountedAt: diasAtras(200), value: 500 }),
    item({ productId: 'c', lastCountedAt: null, value: 2500 }),
  ];

  it('conta SKUs dentro da janela', () => {
    const r = coverageWithin(itens, 90, NOW);
    expect(r.skus).toBe(3);
    expect(r.skusCobertos).toBe(1);
    expect(r.skusPct).toBeCloseTo(33.33, 1);
  });

  it('cobertura por valor diverge da cobertura por SKU', () => {
    const r = coverageWithin(itens, 90, NOW);
    expect(r.valor).toBe(4000);
    expect(r.valorCoberto).toBe(1000);
    expect(r.valorPct).toBe(25);
  });

  it('catálogo vazio devolve zero em vez de dividir por zero', () => {
    const r = coverageWithin([], 90, NOW);
    expect(r.skusPct).toBe(0);
    expect(r.valorPct).toBe(0);
  });

  it('estoque inteiro sem valor não quebra a cobertura por valor', () => {
    const r = coverageWithin([item({ productId: 'z', lastCountedAt: diasAtras(1) })], 90, NOW);
    expect(r.skusPct).toBe(100);
    expect(r.valorPct).toBe(0);
  });
});

describe('breakdownByClass', () => {
  const itens = [
    item({ productId: 'a1', abc: 'A', lastCountedAt: diasAtras(10) }),
    item({ productId: 'a2', abc: 'A', lastCountedAt: diasAtras(60) }),
    item({ productId: 'a3', abc: 'A', lastCountedAt: null }),
    item({ productId: 'c1', abc: 'C', lastCountedAt: diasAtras(60) }),
  ];

  it('separa em dia, atrasado e nunca dentro da classe', () => {
    const [classeA] = breakdownByClass(itens, NOW);
    expect(classeA.bucket).toBe('A');
    expect(classeA.total).toBe(3);
    expect(classeA.emDia).toBe(1);
    expect(classeA.atrasado).toBe(1);
    expect(classeA.nunca).toBe(1);
    expect(classeA.emDiaPct).toBeCloseTo(33.33, 1);
  });

  it('omite classe sem nenhum SKU', () => {
    const buckets = breakdownByClass(itens, NOW).map(l => l.bucket);
    expect(buckets).toEqual(['A', 'C']);
  });

  it('agrupa produto sem classificação num bucket próprio', () => {
    const buckets = breakdownByClass([item({ productId: 'x' })], NOW).map(l => l.bucket);
    expect(buckets).toEqual(['sem']);
  });
});

describe('mostOverdue', () => {
  it('prioriza atraso relativo à cadência, não dias absolutos', () => {
    // O C está parado há muito mais tempo, mas dentro de 180 dias ainda não atrasou;
    // o A, com menos dias, já passou de 30.
    const fila = mostOverdue([
      item({ productId: 'c-antigo', abc: 'C', lastCountedAt: diasAtras(100) }),
      item({ productId: 'a-atrasado', abc: 'A', lastCountedAt: diasAtras(45) }),
    ], 10, NOW);
    expect(fila.map(e => e.productId)).toEqual(['a-atrasado']);
  });

  it('ordena por quantas vezes a cadência foi estourada', () => {
    const fila = mostOverdue([
      item({ productId: 'a-1.5x', abc: 'A', lastCountedAt: diasAtras(45) }),
      item({ productId: 'a-4x', abc: 'A', lastCountedAt: diasAtras(120) }),
    ], 10, NOW);
    expect(fila.map(e => e.productId)).toEqual(['a-4x', 'a-1.5x']);
  });

  it('nunca contado vem antes de qualquer atrasado', () => {
    const fila = mostOverdue([
      item({ productId: 'atrasadissimo', abc: 'A', lastCountedAt: diasAtras(900) }),
      item({ productId: 'nunca', abc: 'C' }),
    ], 10, NOW);
    expect(fila[0].productId).toBe('nunca');
  });

  it('entre nunca contados, o de maior valor vem primeiro', () => {
    const fila = mostOverdue([
      item({ productId: 'barato', value: 10 }),
      item({ productId: 'caro', value: 9000 }),
    ], 10, NOW);
    expect(fila.map(e => e.productId)).toEqual(['caro', 'barato']);
  });

  it('não inclui quem está em dia', () => {
    const fila = mostOverdue([item({ productId: 'ok', abc: 'A', lastCountedAt: diasAtras(5) })], 10, NOW);
    expect(fila).toEqual([]);
  });

  it('respeita o limite pedido', () => {
    const muitos = Array.from({ length: 50 }, (_, i) => item({ productId: `p${i}` }));
    expect(mostOverdue(muitos, 8, NOW)).toHaveLength(8);
  });

  it('não altera o array recebido', () => {
    const itens = [item({ productId: 'b' }), item({ productId: 'a' })];
    mostOverdue(itens, 10, NOW);
    expect(itens.map(i => i.productId)).toEqual(['b', 'a']);
  });
});

describe('resolveBalance', () => {
  it('usa o catálogo quando ele tem saldo, mesmo havendo foto da Fonte', () => {
    expect(resolveBalance(12, 999)).toEqual({ quantity: 12, from: 'catalogo' });
  });

  it('cai para a Fonte de Saldo quando o catálogo está zerado', () => {
    expect(resolveBalance(0, 40)).toEqual({ quantity: 40, from: 'fonte_de_saldo' });
  });

  it('cai para a Fonte de Saldo quando o catálogo é nulo', () => {
    expect(resolveBalance(null, 40)).toEqual({ quantity: 40, from: 'fonte_de_saldo' });
  });

  it('sem saldo em origem nenhuma devolve origem nula, e não "catálogo"', () => {
    expect(resolveBalance(0, 0)).toEqual({ quantity: 0, from: null });
    expect(resolveBalance(null, null)).toEqual({ quantity: 0, from: null });
  });

  it('foto zerada com catálogo zerado não inventa origem', () => {
    expect(resolveBalance(0, null).from).toBeNull();
  });

  // Saldo negativo no catálogo é dado sujo, não "tem saldo": deixar passar colocaria valor
  // parado negativo na cobertura por valor, que não significa nada.
  it('catálogo negativo não vence a Fonte de Saldo', () => {
    expect(resolveBalance(-5, 30)).toEqual({ quantity: 30, from: 'fonte_de_saldo' });
  });
});
