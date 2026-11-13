// Guardas do serviço de congelamento. São sobre o modo de falha SILENCIOSO:
// nenhuma destas quebras daria erro em tempo de execução — todas devolveriam um
// resultado plausível e errado.

import { describe, it, expect } from 'vitest';

const FONTE = import.meta.glob('/src/lib/productFreeze/productFreezeService.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const SERVICO = FONTE['/src/lib/productFreeze/productFreezeService.ts'] ?? '';

describe('productFreezeService — guardas', () => {
  it('o arquivo foi lido (glob vazio passaria vazio e não provaria nada)', () => {
    expect(SERVICO.length).toBeGreaterThan(500);
  });

  it('toda leitura de catálogo é paginada — sem .range() o PostgREST corta em 1.000 sem avisar', () => {
    const selects = SERVICO.match(/\.from\('(products|integration_entity_links|integration_stock_levels)'\)[\s\S]*?;/g) ?? [];
    const leituras = selects.filter(bloco => bloco.includes('.select(') && !bloco.includes('.update('));
    expect(leituras.length).toBeGreaterThanOrEqual(3);

    const semRange = leituras.filter(
      bloco => !bloco.includes('.range(') && !bloco.includes("'frozen_at'") && !bloco.includes('frozen_at, frozen_reason'),
    );
    expect(semRange, `leitura sem .range():\n${semRange.join('\n---\n')}`).toEqual([]);
  });

  it('a paginação para quando a página vem incompleta, e não num número fixo de voltas', () => {
    expect(SERVICO).toContain('if (page.length < FETCH_PAGE) return rows;');
  });

  it('congelar nunca reescreve quem já está congelado', () => {
    expect(SERVICO).toContain(".is('frozen_at', null)");
  });

  it('descongelar limpa os três campos juntos — o CHECK da 127 recusa data sem motivo', () => {
    expect(SERVICO).toContain('{ frozen_at: null, frozen_reason: null, frozen_by: null }');
  });

  it('o motivo gravado é um dos dois que o banco aceita', () => {
    expect(SERVICO).toContain("export type FreezeReason = 'sem_fonte_de_saldo' | 'manual';");
  });
});
