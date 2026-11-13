// Guardas da migration 128 — os resumos de Risco e CBC não contam congelado.
//
// O defeito que ela corrige é um número que discorda da lista logo abaixo dele.
// Uma regressão aqui não quebra nada: só faz o cabeçalho voltar a mentir, que é
// o tipo de erro que ninguém reporta porque parece plausível.

import { describe, it, expect } from 'vitest';

const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const M128 =
  MIGRATIONS[Object.keys(MIGRATIONS).find(p => p.includes('128_summary_views_skip_frozen')) ?? ''] ?? '';

/** O corpo de uma das duas views, da palavra CREATE até o `;` que a fecha. */
function view(nome: string): string {
  const i = M128.indexOf(`CREATE OR REPLACE VIEW ${nome}`);
  if (i < 0) return '';
  const fim = M128.indexOf('GROUP BY s.company_id;', i);
  return fim < 0 ? '' : M128.slice(i, fim + 'GROUP BY s.company_id;'.length);
}

describe('migration 128 — resumos ignoram produto congelado', () => {
  it('o arquivo existe e foi lido (glob vazio passaria vazio e não provaria nada)', () => {
    expect(M128.length).toBeGreaterThan(500);
  });

  it('as duas views filtram o congelado', () => {
    for (const nome of ['risk_company_summary_v', 'cbc_company_summary_v']) {
      const corpo = view(nome);
      expect(corpo, `não achei o corpo de ${nome}`).not.toBe('');
      expect(corpo, `${nome} sem JOIN com products`).toContain('JOIN products p ON p.id = s.product_id');
      expect(corpo, `${nome} sem o filtro de congelado`).toContain('WHERE p.frozen_at IS NULL');
    }
  });

  it('usa CREATE OR REPLACE, não DROP — dropar perde os GRANTs das views', () => {
    expect(M128).not.toMatch(/DROP\s+VIEW/i);
    expect((M128.match(/CREATE OR REPLACE VIEW/g) ?? []).length).toBe(2);
  });

  it('preserva security_invoker nas duas — sem isso a view passa a rodar como dona', () => {
    expect((M128.match(/security_invoker = true/g) ?? []).length).toBe(2);
  });

  it('mantém o conjunto de colunas intacto — CREATE OR REPLACE recusa mudar a lista', () => {
    // 8 no risco, 12 no CBC: são os nomes que a view viva devolve hoje. Mudar
    // qualquer um faz o CREATE OR REPLACE falhar na aplicação, não em produção
    // — mas falhar na aplicação com a tela já publicada também é estrago.
    const risco = view('risk_company_summary_v');
    for (const col of ['avg_risk', 'total_scored', 'critico_count', 'alto_count', 'medio_count', 'baixo_count', 'insufficient_count']) {
      expect(risco, `risco sem a coluna ${col}`).toContain(`AS ${col}`);
    }
    const cbc = view('cbc_company_summary_v');
    for (const col of ['avg_confidence', 'total_scored', 'distinct_locations', 'excelente_count', 'bom_count', 'medio_count', 'critico_count', 'insufficient_count', 'overdue_count', 'due_this_week_count', 'scheduled_this_week_count']) {
      expect(cbc, `cbc sem a coluna ${col}`).toContain(`AS ${col}`);
    }
  });

  it('não toca em tabela, policy nem grant — é só a camada de leitura', () => {
    expect(M128).not.toMatch(/ALTER\s+TABLE/i);
    expect(M128).not.toMatch(/CREATE\s+POLICY/i);
    expect(M128).not.toMatch(/\bGRANT\b/i);
    expect(M128).not.toMatch(/\bDELETE\b/i);
  });
});
