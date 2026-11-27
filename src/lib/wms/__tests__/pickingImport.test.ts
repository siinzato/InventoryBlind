// Planilha e PDF viram as MESMAS linhas que alguem colaria a mao.
//
// O que esta em jogo: planilha lida AO CONTRARIO importa quantidade como codigo e
// vice-versa, e PDF lido fora de ordem cola o codigo de uma linha na quantidade de
// outra. Os dois erros entram calados e so aparecem quando o separador ja esta no
// corredor.

import { describe, expect, it } from 'vitest';
import {
  aplicarAjustes, detectarColunas, linhasDaPlanilha, linhasDeFragmentos, linhasDoPdf,
  type FragmentoDePdf,
} from '../pickingImport';
import type { CellValue } from '../../spreadsheet-comparator/types';

const grade = (linhas: CellValue[][]): CellValue[][] => linhas;

describe('detectarColunas — o cabecalho manda', () => {
  it('acha codigo e quantidade pelo titulo, com acento e caixa misturados', () => {
    const g = grade([
      ['Descrição', 'Código', 'Qtd'],
      ['Bolsa', 'TBGCM55-14', 3],
    ]);
    const c = detectarColunas(g, 0);
    expect(c).toEqual({
      codigo: 1, quantidade: 2, origemDoCodigo: 'cabecalho', origemDaQuantidade: 'cabecalho',
    });
  });

  it('reconhece os sinonimos que planilha de galpao usa', () => {
    for (const titulo of ['SKU', 'EAN', 'GTIN', 'Referencia', 'Item']) {
      expect(detectarColunas(grade([[titulo, 'CAIXAS'], ['X', 1]]), 0).codigo).toBe(0);
    }
    for (const titulo of ['QTDE', 'Quantidade', 'Caixas', 'CX', 'Volumes']) {
      expect(detectarColunas(grade([['SKU', titulo], ['X', 1]]), 0).quantidade).toBe(1);
    }
  });

  it('sem cabecalho util, o conteudo decide — e a origem volta marcada', () => {
    // A tela precisa saber que o palpite NAO veio do cabecalho, para pedir conferencia
    // em vez de seguir calada.
    const g = grade([
      ['coluna a', 'coluna b'],
      ['TBGCM55-14', 3],
      ['GFGCM13-20', 7],
    ]);
    const c = detectarColunas(g, 0);
    expect(c.quantidade).toBe(1);
    expect(c.codigo).toBe(0);
    expect(c.origemDaQuantidade).toBe('conteudo');
    expect(c.origemDoCodigo).toBe('conteudo');
  });

  it('coluna de EAN NAO e confundida com quantidade', () => {
    // EAN-13 e numero inteiro positivo como qualquer quantidade. Sem o teto, a planilha
    // seria lida ao contrario: 7900337078617 caixas do produto "3".
    const g = grade([
      ['a', 'b'],
      ['7900337078617', 3],
      ['7900337078624', 2],
    ]);
    const c = detectarColunas(g, 0);
    expect(c.quantidade).toBe(1);
    expect(c.codigo).toBe(0);
  });

  it('planilha sem nada aproveitavel devolve nulo em vez de chutar', () => {
    expect(detectarColunas(grade([]), 0)).toEqual({
      codigo: null, quantidade: null, origemDoCodigo: 'nenhuma', origemDaQuantidade: 'nenhuma',
    });
  });

  it('cabecalho fora da primeira linha e respeitado', () => {
    const g = grade([
      ['Relatorio de separacao', undefined],
      [undefined, undefined],
      ['SKU', 'Qtd'],
      ['TBGCM55-14', 5],
    ]);
    expect(detectarColunas(g, 2)).toMatchObject({ codigo: 0, quantidade: 1 });
  });
});

describe('linhasDaPlanilha', () => {
  const g = grade([
    ['SKU', 'Qtd'],
    ['TBGCM55-14', 3],
    ['GFGCM13-20', '2'],
    [undefined, undefined],       // separador visual da planilha
    ['SEM-QTD', undefined],
    [undefined, 5],
    ['FRACIONADO', 2.5],
    ['ZERO', 0],
    ['PT-BR', '10,0'],
  ]);

  it('le o que esta pronto', () => {
    expect(linhasDaPlanilha(g, 0, 0, 1).linhas).toEqual([
      { codigo: 'TBGCM55-14', caixas: 3 },
      { codigo: 'GFGCM13-20', caixas: 2 },
      // Em planilha a coluna ja diz o que e quantidade: nao ha a ambiguidade da virgula
      // que a lista colada tem, e "10,0" exportado em pt-BR e dez.
      { codigo: 'PT-BR', caixas: 10 },
    ]);
  });

  it('recusa com o numero da LINHA DA PLANILHA, que e o que aparece no Excel', () => {
    const r = linhasDaPlanilha(g, 0, 0, 1);
    expect(r.recusadas).toEqual([
      { linha: 5, texto: 'SEM-QTD', motivo: 'sem_quantidade' },
      { linha: 6, texto: '5', motivo: 'sem_codigo' },
      { linha: 7, texto: 'FRACIONADO 2.5', motivo: 'quantidade_invalida' },
      { linha: 8, texto: 'ZERO 0', motivo: 'quantidade_invalida' },
    ]);
  });

  it('linha totalmente vazia nao e erro de ninguem', () => {
    const r = linhasDaPlanilha(g, 0, 0, 1);
    expect(r.recusadas.some(x => x.linha === 4)).toBe(false);
  });

  it('sem coluna escolhida nao inventa importacao', () => {
    expect(linhasDaPlanilha(g, 0, null, 1)).toEqual({ linhas: [], recusadas: [] });
    expect(linhasDaPlanilha(g, 0, 0, null)).toEqual({ linhas: [], recusadas: [] });
  });
});

describe('linhasDeFragmentos — PDF nao tem linhas, tem coordenadas', () => {
  const f = (texto: string, x: number, y: number): FragmentoDePdf => ({ texto, x, y });

  it('agrupa por Y e ordena por X', () => {
    // `getTextContent` devolve a ordem INTERNA do arquivo, que nao e a ordem visual.
    const fragmentos = [f('3', 300, 700), f('TBGCM55-14', 100, 700), f('GFGCM13-20', 100, 680), f('7', 300, 680)];
    expect(linhasDeFragmentos(fragmentos)).toEqual(['TBGCM55-14 3', 'GFGCM13-20 7']);
  });

  it('de cima para baixo, porque o Y do PDF cresce para cima', () => {
    expect(linhasDeFragmentos([f('rodape', 10, 50), f('topo', 10, 800)])).toEqual(['topo', 'rodape']);
  });

  it('tolera o desalinhamento de Y da mesma linha', () => {
    // Fragmentos da mesma linha raramente tem o mesmo Y exato: muda com o tamanho da
    // fonte e com sobrescrito.
    expect(linhasDeFragmentos([f('A', 10, 700), f('B', 20, 701.5)])).toEqual(['A B']);
    // E separa o que e linha de verdade.
    expect(linhasDeFragmentos([f('A', 10, 700), f('B', 20, 690)])).toEqual(['A', 'B']);
  });

  it('descarta fragmento vazio sem criar linha fantasma', () => {
    expect(linhasDeFragmentos([f('  ', 10, 700), f('A', 20, 700), f('', 30, 600)])).toEqual(['A']);
    expect(linhasDeFragmentos([])).toEqual([]);
  });
});

describe('linhasDoPdf — mesmo funil da lista colada', () => {
  const f = (texto: string, x: number, y: number): FragmentoDePdf => ({ texto, x, y });

  it('aproveita o que da e devolve o resto para conferencia', () => {
    const r = linhasDoPdf([
      f('TBGCM55-14', 100, 700), f('3', 300, 700),
      f('SEM-QUANTIDADE', 100, 680),
      f('GFGCM13-20', 100, 660), f('7', 300, 660),
    ]);
    expect(r.linhas).toEqual([
      { codigo: 'TBGCM55-14', caixas: 3 },
      { codigo: 'GFGCM13-20', caixas: 7 },
    ]);
    expect(r.recusadas.map(x => x.motivo)).toEqual(['sem_quantidade']);
  });

  it('herda a regra da ambiguidade da lista colada', () => {
    // Numero solto antes da quantidade continua sendo ambiguo — o PDF e texto livre
    // como o que se cola, e uma segunda interpretacao divergiria da primeira.
    const r = linhasDoPdf([f('ITEM', 100, 700), f('10', 200, 700), f('5', 300, 700)]);
    expect(r.linhas).toEqual([]);
    expect(r.recusadas.map(x => x.motivo)).toEqual(['ambigua']);
  });
});

describe('aplicarAjustes — corrigir a linha venha ela de onde vier', () => {
  const previa = {
    linhas: [{ codigo: 'OK-1', caixas: 2 }],
    recusadas: [
      { linha: 5, texto: 'SEM-QTD', motivo: 'sem_quantidade' as const },
      { linha: 7, texto: 'ZERO 0', motivo: 'quantidade_invalida' as const },
    ],
  };

  it('a linha corrigida entra na importacao', () => {
    const r = aplicarAjustes(previa, { 5: 'SEM-QTD 4' });
    expect(r.linhas).toEqual([{ codigo: 'OK-1', caixas: 2 }, { codigo: 'SEM-QTD', caixas: 4 }]);
    expect(r.recusadas.map(x => x.linha)).toEqual([7]);
  });

  it('correcao que continua ruim mantem o NUMERO da linha de origem', () => {
    // E por ele que a pessoa se localiza no arquivo; trocar por um indice novo faria
    // "corrija a linha 2" apontar para outro lugar.
    const r = aplicarAjustes(previa, { 7: 'ZERO abc' });
    expect(r.recusadas).toContainEqual({ linha: 7, texto: 'ZERO abc', motivo: 'quantidade_invalida' });
  });

  it('sem ajuste, nada muda', () => {
    expect(aplicarAjustes(previa, {})).toEqual(previa);
  });

  it('ajuste identico ao original nao reprocessa', () => {
    const r = aplicarAjustes(previa, { 5: '  SEM-QTD  ' });
    expect(r.recusadas.map(x => x.linha)).toEqual([5, 7]);
  });
});
