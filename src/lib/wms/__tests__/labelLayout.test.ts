// Guardas das medidas da etiqueta.
//
// Etiqueta errada só aparece no papel, depois de gastar o rolo. Estas asserções são a
// única chance de pegar antes.

import { describe, expect, it } from 'vitest';
import { A4_PER_PAGE, LABEL_FORMATS, fallbackValuePt, planLabels, sheetsFor, type A4PerPage } from '../labelLayout';

const plan = (over: Partial<Parameters<typeof planLabels>[0]> = {}) =>
  planLabels({ format: 'a4', perPage: 8, customWidthMm: 70, customHeightMm: 50, ...over });

describe('formatos de rolo — a etiqueta É a página', () => {
  // Os mesmos do Gerador de Etiquetas. Se divergirem, quem comprou rolo para um não
  // consegue usar no outro.
  it('vão é 100×40 e excesso é 100×150', () => {
    expect(plan({ format: 'vao' })).toMatchObject({ labelWidthMm: 100, labelHeightMm: 40 });
    expect(plan({ format: 'excesso' })).toMatchObject({ labelWidthMm: 100, labelHeightMm: 150 });
  });

  // Margem em rolo desloca a impressão etiqueta a etiqueta e o erro vai acumulando.
  it('rolo imprime sem margem, uma por página e sem marca de corte', () => {
    for (const format of ['vao', 'excesso', 'custom'] as const) {
      const p = plan({ format });
      expect(p.pageCss).toContain('margin: 0');
      expect(p.perPage).toBe(1);
      expect(p.columns).toBe(1);
      expect(p.showCutBorder).toBe(false);
    }
  });

  // 100×40 não comporta QR em cima e endereço embaixo.
  it('etiqueta deitada vira QR ao lado do endereço', () => {
    expect(plan({ format: 'vao' }).orientation).toBe('horizontal');
    expect(plan({ format: 'excesso' }).orientation).toBe('vertical');
  });

  it('medida personalizada é contida na faixa que uma impressora aceita', () => {
    expect(plan({ format: 'custom', customWidthMm: 5, customHeightMm: 5 }))
      .toMatchObject({ labelWidthMm: 25, labelHeightMm: 15 });
    expect(plan({ format: 'custom', customWidthMm: 9999, customHeightMm: 9999 }))
      .toMatchObject({ labelWidthMm: 210, labelHeightMm: 297 });
  });
});

describe('folha A4', () => {
  it('as grades cabem na folha, com margem e respiro', () => {
    for (const perPage of A4_PER_PAGE) {
      const p = plan({ perPage });
      const cols = p.columns;
      const rows = p.perPage / cols;
      const larguraUsada = p.labelWidthMm * cols + p.gapMm * (cols - 1);
      const alturaUsada = p.labelHeightMm * rows + p.gapMm * (rows - 1);
      expect(larguraUsada).toBeLessThanOrEqual(210 - 16);
      expect(alturaUsada).toBeLessThanOrEqual(297 - 16);
      expect(p.showCutBorder).toBe(true);
    }
  });

  it('a quantidade escolhida é a que sai na folha', () => {
    for (const perPage of A4_PER_PAGE) {
      expect(plan({ perPage }).perPage).toBe(perPage);
    }
  });

  it('valor fora da lista cai no padrão em vez de quebrar', () => {
    expect(plan({ perPage: 7 as unknown as A4PerPage }).perPage).toBe(8);
  });
});

describe('o QR continua legível em qualquer formato', () => {
  // Abaixo de ~14mm o celular não lê com a estrutura na frente. Uma grade densa não
  // pode encolher o código até ele virar enfeite.
  it('nenhum formato gera QR menor que 14 mm', () => {
    const todos = [
      ...A4_PER_PAGE.map(perPage => plan({ perPage })),
      plan({ format: 'vao' }),
      plan({ format: 'excesso' }),
      plan({ format: 'custom', customWidthMm: 25, customHeightMm: 15 }),
    ];
    for (const p of todos) expect(p.qrMm).toBeGreaterThanOrEqual(14);
  });

  it('o corpo do endereço acompanha a largura disponível, sem sumir nem estourar', () => {
    const pequena = plan({ perPage: 24 });
    const grande = plan({ format: 'excesso' });
    expect(pequena.valuePt).toBeLessThan(grande.valuePt);
    for (const p of [pequena, grande]) {
      expect(p.valuePt).toBeGreaterThanOrEqual(8);
      expect(p.valuePt).toBeLessThanOrEqual(34);
      expect(p.headerPt).toBeLessThan(p.valuePt);
      expect(p.codePt).toBeLessThan(p.valuePt);
    }
  });
});

describe('contagem de folhas', () => {
  it('85 endereços em grades diferentes', () => {
    expect(sheetsFor(85, plan({ perPage: 8 }))).toBe(11);
    expect(sheetsFor(85, plan({ perPage: 24 }))).toBe(4);
    expect(sheetsFor(85, plan({ format: 'vao' }))).toBe(85);
  });

  it('nunca promete zero folha', () => {
    expect(sheetsFor(0, plan())).toBe(1);
  });
});

describe('a lista de formatos da tela', () => {
  it('cobre exatamente os formatos que o planejador entende', () => {
    expect(LABEL_FORMATS.map(f => f.id)).toEqual(['a4', 'vao', 'excesso', 'custom']);
  });
});

describe('endereço fora do padrão não some pela borda', () => {
  // `nowrap` + `overflow: hidden` na célula: texto que não cabe não quebra linha, some.
  // Foi o que aconteceu com "VAGA-SOLTA" na grade de 24 antes deste ajuste.
  it('o corpo cede ao comprimento do código', () => {
    const densa = plan({ perPage: 24 });
    expect(fallbackValuePt(densa, 10)).toBeLessThan(densa.valuePt);
    expect(fallbackValuePt(densa, 30)).toBeLessThan(fallbackValuePt(densa, 10));
  });

  it('código curto não fica maior que o resto da etiqueta', () => {
    for (const p of [plan(), plan({ perPage: 24 }), plan({ format: 'vao' })]) {
      expect(fallbackValuePt(p, 1)).toBeLessThanOrEqual(p.valuePt);
    }
  });

  it('nunca encolhe a ponto de ser ilegível', () => {
    expect(fallbackValuePt(plan({ perPage: 24 }), 200)).toBeGreaterThanOrEqual(5);
  });
});
