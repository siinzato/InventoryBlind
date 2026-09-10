// Guardas de código-fonte da ferramenta Emitir Relatório. Duas invariantes que
// nenhum teste de comportamento pega: isolamento por workspace na leitura e
// ausência total de escrita — emitir folha de contagem é preparatório para
// impressão e não pode tocar estoque, produto, contagem nem movimentação.
// Mesmo padrão de src/lib/abcCurve/__tests__/abcCurveGuards.test.ts.

import { describe, it, expect } from 'vitest';

const LIB = import.meta.glob('/src/lib/reports/*.ts', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;
const COMPONENTS = import.meta.glob('/src/components/reports/*.tsx', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const ALL = { ...LIB, ...COMPONENTS };

describe('Emitir Relatório — isolamento por workspace', () => {
  it('toda query em products filtra por company_id', () => {
    for (const [path, source] of Object.entries(ALL)) {
      const queries = source.match(/from\('products'\)/g) ?? [];
      if (queries.length === 0) continue;
      expect(source, `${path} consulta products sem filtrar company_id`).toMatch(
        /\.eq\('company_id', companyId\)/
      );
    }
  });

  it('nenhum arquivo da ferramenta acessa supabase fora do serviço de leitura', () => {
    for (const [path, source] of Object.entries(ALL)) {
      if (path.endsWith('inventoryReportService.ts')) continue;
      expect(source, `${path} não deveria importar o client Supabase`).not.toMatch(
        /from '\.\.?\/(\.\.\/)?lib\/supabase'|from '\.\.\/supabase'/
      );
    }
  });
});

describe('Emitir Relatório — somente leitura', () => {
  const WRITE_CALLS = ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc('];

  it('o único arquivo com acesso ao banco não tem nenhuma chamada de escrita', () => {
    // Só faz sentido checar quem importa o client — o teste de isolamento acima
    // garante que nenhum outro arquivo da ferramenta importa Supabase, então
    // nenhum outro tem como escrever. (`.delete(` aparece legitimamente em Set
    // dentro dos componentes; por isso a checagem é escopada.)
    const service = LIB['/src/lib/reports/inventoryReportService.ts'];
    expect(service, 'inventoryReportService.ts não foi encontrado').toBeTruthy();
    for (const call of WRITE_CALLS) {
      expect(service.includes(call), `inventoryReportService.ts contém ${call}`).toBe(false);
    }
  });
});
