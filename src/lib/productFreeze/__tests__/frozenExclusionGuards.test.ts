// Guardas da exclusão de produto congelado.
//
// Nenhuma destas quebras daria erro em tempo de execução. Todas devolveriam um
// resultado plausível e errado: a folha de contagem voltaria a imprimir produto
// que saiu da fonte, e a fila de recontagem voltaria a agendá-lo. Como ninguém
// olha uma folha procurando o que NÃO deveria estar lá, a regressão passaria.

import { describe, it, expect } from 'vitest';

const FONTES = import.meta.glob(
  [
    '/src/lib/reports/inventoryReportService.ts',
    '/src/lib/riskService.ts',
    '/src/lib/cbcService.ts',
  ],
  { query: '?raw', import: 'default', eager: true }
) as Record<string, string>;

const FOLHA = FONTES['/src/lib/reports/inventoryReportService.ts'] ?? '';
const RISCO = FONTES['/src/lib/riskService.ts'] ?? '';
const CBC = FONTES['/src/lib/cbcService.ts'] ?? '';

describe('produto congelado fica fora das filas e da folha', () => {
  it('os três arquivos foram lidos (glob vazio passaria vazio e não provaria nada)', () => {
    expect(FOLHA.length).toBeGreaterThan(500);
    expect(RISCO.length).toBeGreaterThan(500);
    expect(CBC.length).toBeGreaterThan(500);
  });

  it('a folha de contagem não carrega produto congelado', () => {
    // O trecho inteiro da query, não só a presença de ".is(" em algum lugar do
    // arquivo: um filtro colocado em outra consulta não protege esta.
    const query = FOLHA.match(/\.from\('products'\)[\s\S]*?\.range\([^)]*\);/);
    expect(query, 'não achei a leitura do catálogo da folha').not.toBeNull();
    expect(query?.[0]).toContain(".is('frozen_at', null)");
  });

  it('o recálculo de risco não varre produto congelado', () => {
    const query = RISCO.match(/'Risk\/products'[\s\S]*?\);/);
    expect(query, 'não achei a varredura do recálculo de risco').not.toBeNull();
    expect(query?.[0]).toContain(".is('frozen_at', null)");
  });

  it('o recálculo de CBC não varre produto congelado — senão volta a reagendar', () => {
    const query = CBC.match(/'CBC\/products'[\s\S]*?\);/);
    expect(query, 'não achei a varredura do recálculo de CBC').not.toBeNull();
    expect(query?.[0]).toContain(".is('frozen_at', null)");
  });

  it('a lista de risco filtra pelo produto, não pela tabela de notas', () => {
    // `products!inner` é o que torna o filtro possível. Sem o inner, o filtro
    // sobre a tabela embutida é ignorado e a lista volta a trazer tudo.
    // Janela fixa a partir do início da query, em vez de "até o próximo `;`":
    // um ponto e vírgula escrito dentro de um comentário encerrava a captura
    // antes do filtro, e a guarda reprovava código correto. Olhar uma janela
    // também impede o oposto — achar o filtro numa consulta diferente.
    const query = RISCO.match(/let query = supabase[\s\S]{0,500}/);
    expect(query, 'não achei a lista de risco').not.toBeNull();
    expect(query?.[0]).toContain('products!inner');
    expect(query?.[0]).toContain(".is('products.frozen_at', null)");
  });

  it('a lista de CBC filtra pelo produto, não pela tabela de notas', () => {
    const query = CBC.match(/let query = supabase[\s\S]{0,500}/);
    expect(query, 'não achei a lista de CBC').not.toBeNull();
    expect(query?.[0]).toContain('products!inner');
    expect(query?.[0]).toContain(".is('products.frozen_at', null)");
  });

  it('o filtro embutido exige frozen_at no select — sem isso o PostgREST não filtra', () => {
    for (const [nome, fonte] of [['risco', RISCO], ['cbc', CBC]] as const) {
      const selects = fonte.match(/products!inner\([^)]*\)/g) ?? [];
      const usados = selects.filter(sel => sel.includes('frozen_at'));
      expect(usados.length, `${nome}: products!inner sem frozen_at no select`).toBeGreaterThan(0);
    }
  });
});
