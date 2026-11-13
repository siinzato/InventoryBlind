import { describe, it, expect } from 'vitest';
import { reconcileAgainstSource, type ReconciliationInput } from '../productFreezeRule';

const SNAPSHOT = '2026-11-13T11:08:58.000Z';

const base: ReconciliationInput = {
  productId: 'p1',
  sku: 'SKU-1',
  name: 'Produto 1',
  hasSourceLink: true,
  lastObservedAt: SNAPSHOT,
  frozenAt: null,
};

describe('reconcileAgainstSource', () => {
  it('produto que veio na importação mais recente está presente', () => {
    const r = reconcileAgainstSource([base], SNAPSHOT);
    expect(r.presentes).toBe(1);
    expect(r.sumiramDaFonte).toHaveLength(0);
    expect(r.nuncaVieram).toHaveLength(0);
  });

  it('produto com vínculo e saldo antigo sumiu da fonte, com os dias apurados', () => {
    const r = reconcileAgainstSource(
      [{ ...base, lastObservedAt: '2026-09-17T11:38:46.000Z' }],
      SNAPSHOT,
    );
    expect(r.sumiramDaFonte).toHaveLength(1);
    expect(r.sumiramDaFonte[0].status).toBe('sumiu_da_fonte');
    // 56, nao 57: a hora do snapshot (11:08) e ANTERIOR a hora do ultimo saldo
    // visto (11:38), entao o ultimo dia nao fechou. Dia parcial nao conta como dia.
    expect(r.sumiramDaFonte[0].diasSemFonte).toBe(56);
    expect(r.presentes).toBe(0);
  });

  it('produto sem vínculo NUNCA veio — não entra na lista de candidatos a congelar', () => {
    const r = reconcileAgainstSource([{ ...base, hasSourceLink: false, lastObservedAt: null }], SNAPSHOT);
    expect(r.sumiramDaFonte).toHaveLength(0);
    expect(r.nuncaVieram).toHaveLength(1);
    expect(r.nuncaVieram[0].status).toBe('nunca_veio');
    expect(r.nuncaVieram[0].diasSemFonte).toBeNull();
  });

  it('as duas causas de célula em branco não são fundidas', () => {
    const r = reconcileAgainstSource(
      [
        { ...base, productId: 'a', sku: 'A', lastObservedAt: '2026-09-17T11:38:46.000Z' },
        { ...base, productId: 'b', sku: 'B', hasSourceLink: false, lastObservedAt: null },
      ],
      SNAPSHOT,
    );
    expect(r.sumiramDaFonte.map(x => x.sku)).toEqual(['A']);
    expect(r.nuncaVieram.map(x => x.sku)).toEqual(['B']);
  });

  it('produto já congelado não volta a ser sugerido', () => {
    const r = reconcileAgainstSource(
      [{ ...base, lastObservedAt: '2026-09-17T11:38:46.000Z', frozenAt: '2026-11-01T00:00:00.000Z' }],
      SNAPSHOT,
    );
    expect(r.sumiramDaFonte).toHaveLength(0);
    expect(r.congelados).toBe(1);
  });

  it('vínculo sem saldo nenhum conta como sumido, sem inventar "desde quando"', () => {
    const r = reconcileAgainstSource([{ ...base, lastObservedAt: null }], SNAPSHOT);
    expect(r.sumiramDaFonte).toHaveLength(1);
    expect(r.sumiramDaFonte[0].diasSemFonte).toBeNull();
  });

  it('sem nenhuma importação, NADA é sugerido — ausência de dado não é prova de sumiço', () => {
    const r = reconcileAgainstSource(
      [
        { ...base, lastObservedAt: null },
        { ...base, productId: 'b', sku: 'B', hasSourceLink: false, lastObservedAt: null },
      ],
      null,
    );
    expect(r.sumiramDaFonte).toHaveLength(0);
    expect(r.nuncaVieram).toHaveLength(0);
    expect(r.presentes).toBe(2);
  });

  it('quem sumiu há mais tempo aparece primeiro, e quem não tem data vai ao topo', () => {
    const r = reconcileAgainstSource(
      [
        { ...base, productId: 'recente', sku: 'R', lastObservedAt: '2026-11-01T00:00:00.000Z' },
        { ...base, productId: 'antigo', sku: 'A', lastObservedAt: '2026-09-17T00:00:00.000Z' },
        { ...base, productId: 'semdata', sku: 'S', lastObservedAt: null },
      ],
      SNAPSHOT,
    );
    expect(r.sumiramDaFonte.map(x => x.sku)).toEqual(['S', 'A', 'R']);
  });

  it('catálogo vazio não quebra e não inventa candidato', () => {
    const r = reconcileAgainstSource([], SNAPSHOT);
    expect(r).toEqual({ sumiramDaFonte: [], nuncaVieram: [], presentes: 0, congelados: 0 });
  });
});
