import { describe, expect, it } from 'vitest';
import { fetchAllPages, SUPABASE_PAGE } from '../supabasePagination';

/** Tabela falsa com N linhas que respeita `range` como o PostgREST respeita:
 *  devolve no máximo o bloco pedido, e nunca mais que o teto do servidor. */
function fakeTable(total: number, teto = SUPABASE_PAGE) {
  const chamadas: Array<[number, number]> = [];
  const build = (from: number, to: number) => {
    chamadas.push([from, to]);
    const fim = Math.min(to + 1, from + teto, total);
    const data = [];
    for (let i = from; i < fim; i++) data.push({ i });
    return Promise.resolve({ data, error: null });
  };
  return { build, chamadas };
}

describe('fetchAllPages', () => {
  it('lê além do teto de 1.000 — o caso que motivou o módulo', async () => {
    // 4.628 é o catálogo real desta base: era exatamente onde a leitura parava em 1.000.
    const { build, chamadas } = fakeTable(4628);
    const { rows, error } = await fetchAllPages<{ i: number }>('teste', build);
    expect(error).toBeNull();
    expect(rows).toHaveLength(4628);
    expect(chamadas).toHaveLength(5);
    expect(chamadas[0]).toEqual([0, 999]);
    expect(chamadas[4]).toEqual([4000, 4999]);
  });

  it('não devolve linha repetida nem linha faltando na virada de bloco', async () => {
    const { build } = fakeTable(2500);
    const { rows } = await fetchAllPages<{ i: number }>('teste', build);
    expect(new Set(rows.map(r => r.i)).size).toBe(2500);
    expect(rows[0].i).toBe(0);
    expect(rows[2499].i).toBe(2499);
  });

  it('para no primeiro bloco quando a tabela cabe nele (sem consulta extra)', async () => {
    const { build, chamadas } = fakeTable(31);
    const { rows } = await fetchAllPages<{ i: number }>('teste', build);
    expect(rows).toHaveLength(31);
    expect(chamadas).toHaveLength(1);
  });

  it('tabela vazia devolve lista vazia e uma consulta só', async () => {
    const { build, chamadas } = fakeTable(0);
    const { rows, error } = await fetchAllPages<{ i: number }>('teste', build);
    expect(rows).toEqual([]);
    expect(error).toBeNull();
    expect(chamadas).toHaveLength(1);
  });

  it('tabela com exatamente 1.000 linhas não para achando que acabou', async () => {
    // Regressão direta: 1.000 é o tamanho do bloco, então o laço precisa de uma
    // consulta a mais para descobrir que ali realmente termina.
    const { build, chamadas } = fakeTable(1000);
    const { rows } = await fetchAllPages<{ i: number }>('teste', build);
    expect(rows).toHaveLength(1000);
    expect(chamadas).toHaveLength(2);
  });

  it('maxRows corta onde foi pedido, e não onde o servidor cortaria', async () => {
    // `.limit(2000)` entregava 1.000 porque o teto vinha antes. Aqui 2.000 é 2.000.
    const { build, chamadas } = fakeTable(5000);
    const { rows } = await fetchAllPages<{ i: number }>('teste', build, 2000);
    expect(rows).toHaveLength(2000);
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1]).toEqual([1000, 1999]);
  });

  it('maxRows não inventa linha quando a tabela é menor que o teto pedido', async () => {
    const { build } = fakeTable(120);
    const { rows } = await fetchAllPages<{ i: number }>('teste', build, 2000);
    expect(rows).toHaveLength(120);
  });

  it('erro no meio devolve o parcial E o erro — nunca parcial em silêncio', async () => {
    let n = 0;
    const build = (from: number, to: number) => {
      n++;
      if (n === 2) return Promise.resolve({ data: null, error: { message: 'caiu' } });
      const data = [];
      for (let i = from; i <= to; i++) data.push({ i });
      return Promise.resolve({ data, error: null });
    };
    const { rows, error } = await fetchAllPages<{ i: number }>('teste', build);
    expect(error?.message).toBe('caiu');
    expect(rows).toHaveLength(1000);
  });
});
