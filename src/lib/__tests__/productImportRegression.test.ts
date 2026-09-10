import { describe, expect, it } from 'vitest';
import { parseCSV, parseCSVLine } from '../productImportUtils';

// 25. Importador de Produtos existente sem regressão — a única mudança feita
// nele para o Comparador de Planilhas reaproveitar o parser foi exportar
// parseCSVLine (antes privada); nenhuma lógica mudou. Este teste fixa o
// comportamento de parseCSV (usada por ProductImportPage) e confirma que
// parseCSVLine, agora exportada, se comporta exatamente como antes.
describe('productImportUtils — parseCSV/parseCSVLine sem regressão', () => {
  it('parseCSV continua interpretando ; como delimitador e respeitando aspas', () => {
    const { headers, rows } = parseCSV('Nome;SKU;Preço\n"Produto A";A1;10,50\n"Produto; com ponto e vírgula";A2;20');
    expect(headers).toEqual(['Nome', 'SKU', 'Preço']);
    expect(rows).toEqual([
      { Nome: 'Produto A', SKU: 'A1', Preço: '10,50' },
      { Nome: 'Produto; com ponto e vírgula', SKU: 'A2', Preço: '20' },
    ]);
  });

  it('parseCSV usa vírgula quando não há ponto e vírgula na primeira linha', () => {
    const { headers, rows } = parseCSV('Nome,SKU\nProduto A,A1');
    expect(headers).toEqual(['Nome', 'SKU']);
    expect(rows).toEqual([{ Nome: 'Produto A', SKU: 'A1' }]);
  });

  it('parseCSVLine (agora exportada) trata aspas duplas escapadas', () => {
    expect(parseCSVLine('a;"b ""quoted"" c";d', ';')).toEqual(['a', 'b "quoted" c', 'd']);
  });

  it('parseCSVLine mantém o comportamento de trim em cada valor', () => {
    expect(parseCSVLine(' a ; b ;c', ';')).toEqual(['a', 'b', 'c']);
  });
});
