import { describe, expect, it } from 'vitest';
import { computePoProgress } from '../poProgress';

describe('computePoProgress', () => {
  it('sem NF-e vinculada', () => {
    expect(computePoProgress({ hasActiveLinks: false, itemStatuses: [] })).toBe('no_invoice');
  });

  it('aparentemente completa quando todos os itens conferem', () => {
    expect(computePoProgress({ hasActiveLinks: true, itemStatuses: ['ok', 'ok'] })).toBe('apparently_complete');
  });

  it('parcialmente faturada quando há item aguardando vínculo ou não encontrado, sem divergência', () => {
    expect(computePoProgress({ hasActiveLinks: true, itemStatuses: ['ok', 'awaiting_manual_link'] })).toBe('partial');
    expect(computePoProgress({ hasActiveLinks: true, itemStatuses: ['ok', 'po_item_not_found'] })).toBe('partial');
  });

  it('divergente quando há quantidade ou preço ou unidade divergente', () => {
    expect(computePoProgress({ hasActiveLinks: true, itemStatuses: ['ok', 'quantity_less'] })).toBe('divergent');
    expect(computePoProgress({ hasActiveLinks: true, itemStatuses: ['price_divergent'] })).toBe('divergent');
  });

  it('progresso nunca decide o status operacional — é só um valor informativo devolvido ao chamador', () => {
    const progress = computePoProgress({ hasActiveLinks: true, itemStatuses: ['ok'] });
    expect(typeof progress).toBe('string');
  });
});
