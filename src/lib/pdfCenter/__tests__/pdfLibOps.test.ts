// Testes de integração REAIS com pdf-lib (não é mock) — pdf-lib não depende
// de DOM, então roda em Node puro. As fixtures são geradas em memória com o
// próprio pdf-lib, sem arquivo externo.
import { PDFDocument, degrees } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  buildNupPdf, buildPdfFromImages, buildPdfFromPageRefs, buildThermalPdf, getPdfLibPageCount, optimizeConservative,
} from '../pdfLibOps';
import { mmToPt } from '../units';

const ONE_PX_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function makeFixture(pageSizes: Array<[number, number]>, rotate?: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const [w, h] of pageSizes) {
    const page = doc.addPage([w, h]);
    // Uma página sem nenhum desenho não tem /Contents, e o pdf-lib recusa
    // embutir uma página assim (`embedPage`) — toda página real tem conteúdo,
    // então a fixture precisa de pelo menos um traço pra representar isso.
    page.drawLine({ start: { x: 0, y: 0 }, end: { x: 1, y: 1 } });
    if (rotate) page.setRotation(degrees(rotate));
  }
  return doc.save();
}

/** Página SEM `/Contents` de verdade (nunca desenhou nada nela) — caso raro
 *  mas real (ex.: página em branco inserida de propósito). `embedPage` do
 *  pdf-lib recusa embutir isso; thermal/N-up precisam detectar ANTES de
 *  tentar (ver `hasEmbeddableContent` em pdfLibOps.ts) — checar só depois,
 *  num try/catch em volta do embed, não protege nada, porque o pdf-lib só
 *  faz o embed de verdade dentro de `save()`, então o erro escapa de novo
 *  ali e derruba o documento inteiro. */
async function makeBlankFixture(pageSizes: Array<[number, number]>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const [w, h] of pageSizes) doc.addPage([w, h]);
  return doc.save();
}

describe('buildPdfFromPageRefs (união/divisão/intercalação)', () => {
  it('mescla páginas de fontes diferentes preservando o tamanho original de cada uma (nunca impõe A4)', async () => {
    const a = await makeFixture([[100, 200]]);
    const b = await makeFixture([[300, 150]]);

    const merged = await buildPdfFromPageRefs(
      [{ sourceId: 'a', bytes: a }, { sourceId: 'b', bytes: b }],
      [{ sourceId: 'a', sourcePageIndex: 0, rotationCw: 0 }, { sourceId: 'b', sourcePageIndex: 0, rotationCw: 0 }]
    );

    const out = await PDFDocument.load(merged);
    expect(out.getPageCount()).toBe(2);
    expect(out.getPage(0).getSize()).toEqual({ width: 100, height: 200 });
    expect(out.getPage(1).getSize()).toEqual({ width: 300, height: 150 });
  });

  it('extrai só as páginas pedidas, na ordem pedida (divisão/extração)', async () => {
    // três páginas de tamanhos DIFERENTES — dá pra confirmar que a extração
    // pegou exatamente as páginas certas, olhando o tamanho de cada uma.
    const doc = await makeFixture([[50, 50], [60, 60], [70, 70]]);

    const extracted = await buildPdfFromPageRefs(
      [{ sourceId: 'doc', bytes: doc }],
      [
        { sourceId: 'doc', sourcePageIndex: 2, rotationCw: 0 },
        { sourceId: 'doc', sourcePageIndex: 0, rotationCw: 0 },
      ]
    );

    const out = await PDFDocument.load(extracted);
    expect(out.getPageCount()).toBe(2);
    expect(out.getPage(0).getSize()).toEqual({ width: 70, height: 70 });
    expect(out.getPage(1).getSize()).toEqual({ width: 50, height: 50 });
  });

  it('soma a rotação extra à rotação nativa da página (módulo 360)', async () => {
    const doc = await makeFixture([[100, 200]], 90);

    const rotated = await buildPdfFromPageRefs(
      [{ sourceId: 'doc', bytes: doc }],
      [{ sourceId: 'doc', sourcePageIndex: 0, rotationCw: 180 }]
    );

    const out = await PDFDocument.load(rotated);
    expect(out.getPage(0).getRotation().angle).toBe(270);
  });

  it('intercala páginas de dois documentos (via a mesma primitiva)', async () => {
    const a = await makeFixture([[10, 10], [20, 20]]);
    const b = await makeFixture([[30, 30], [40, 40]]);

    const interleaved = await buildPdfFromPageRefs(
      [{ sourceId: 'a', bytes: a }, { sourceId: 'b', bytes: b }],
      [
        { sourceId: 'a', sourcePageIndex: 0, rotationCw: 0 },
        { sourceId: 'b', sourcePageIndex: 0, rotationCw: 0 },
        { sourceId: 'a', sourcePageIndex: 1, rotationCw: 0 },
        { sourceId: 'b', sourcePageIndex: 1, rotationCw: 0 },
      ]
    );

    const out = await PDFDocument.load(interleaved);
    const sizes = Array.from({ length: 4 }, (_, i) => out.getPage(i).getSize().width);
    expect(sizes).toEqual([10, 30, 20, 40]);
  });
});

describe('buildThermalPdf (preparo térmico)', () => {
  it('gera uma página no tamanho alvo, sem exceder os limites', async () => {
    const doc = await makeFixture([[mmToPt(210), mmToPt(297)]]); // A4 origem

    const result = await buildThermalPdf(
      [{ sourceId: 'doc', bytes: doc }],
      [{ sourceId: 'doc', sourcePageIndex: 0, rotationCw: 0 }],
      {
        targetWidthPt: mmToPt(100), targetHeightPt: mmToPt(150),
        fitMode: 'contain', orientation: 'auto', alignX: 'center', alignY: 'center',
        marginPt: { top: 0, right: 0, bottom: 0, left: 0 }, scale: 1, offsetXPt: 0, offsetYPt: 0,
        backgroundWhite: true,
      }
    );

    const out = await PDFDocument.load(result.bytes);
    expect(out.getPageCount()).toBe(1);
    const size = out.getPage(0).getSize();
    expect(size.width).toBeCloseTo(mmToPt(100), 3);
    expect(size.height).toBeCloseTo(mmToPt(150), 3);
  });

  it('não trava numa página com rotação nativa e orienta pelo tamanho efetivo', async () => {
    // 300x100 bruto + /Rotate 90 => efetivo é 100x300 (em pé) na hora de decidir orientação.
    const doc = await makeFixture([[300, 100]], 90);

    const result = await buildThermalPdf(
      [{ sourceId: 'doc', bytes: doc }],
      [{ sourceId: 'doc', sourcePageIndex: 0, rotationCw: 0 }],
      {
        targetWidthPt: mmToPt(100), targetHeightPt: mmToPt(150),
        fitMode: 'contain', orientation: 'auto', alignX: 'center', alignY: 'center',
        marginPt: { top: 0, right: 0, bottom: 0, left: 0 }, scale: 1, offsetXPt: 0, offsetYPt: 0,
        backgroundWhite: false,
      }
    );

    const out = await PDFDocument.load(result.bytes);
    const size = out.getPage(0).getSize();
    // efetivo 100x300 é retrato -> preset 100x150 já é retrato -> não gira a folha.
    expect(size.width).toBeCloseTo(mmToPt(100), 3);
    expect(size.height).toBeCloseTo(mmToPt(150), 3);
  });

  it('página de origem sem /Contents vira aviso, nunca derruba o documento (regressão)', async () => {
    const doc = await makeBlankFixture([[100, 150]]);
    const result = await buildThermalPdf(
      [{ sourceId: 'doc', bytes: doc }],
      [{ sourceId: 'doc', sourcePageIndex: 0, rotationCw: 0 }],
      {
        targetWidthPt: mmToPt(100), targetHeightPt: mmToPt(150),
        fitMode: 'contain', orientation: 'auto', alignX: 'center', alignY: 'center',
        marginPt: { top: 0, right: 0, bottom: 0, left: 0 }, scale: 1, offsetXPt: 0, offsetYPt: 0,
        backgroundWhite: false,
      }
    );
    expect(result.warnings.some(w => w.includes('em branco'))).toBe(true);
    const out = await PDFDocument.load(result.bytes);
    expect(out.getPageCount()).toBe(1);
  });
});

describe('buildNupPdf (montagem de folhas)', () => {
  it('agrupa em folhas de rows*cols e usa exatamente 1 folha quando cabe tudo', async () => {
    const doc = await makeFixture([[100, 100], [100, 100], [100, 100], [100, 100]]);
    const refs = Array.from({ length: 4 }, (_, i) => ({ sourceId: 'doc', sourcePageIndex: i, rotationCw: 0 as const }));

    const result = await buildNupPdf([{ sourceId: 'doc', bytes: doc }], refs, {
      pageWidthPt: mmToPt(210), pageHeightPt: mmToPt(297), rows: 2, cols: 2,
      marginPt: { top: 10, right: 10, bottom: 10, left: 10 }, spacingPt: { row: 5, col: 5 },
      fillOrder: 'linhas', cellFit: 'contain', showCutMarks: true, showBorder: true,
    });

    const out = await PDFDocument.load(result.bytes);
    expect(out.getPageCount()).toBe(1);
  });

  it('usa múltiplas folhas quando não cabe tudo numa só', async () => {
    const doc = await makeFixture([[10, 10], [10, 10], [10, 10], [10, 10], [10, 10]]);
    const refs = Array.from({ length: 5 }, (_, i) => ({ sourceId: 'doc', sourcePageIndex: i, rotationCw: 0 as const }));

    const result = await buildNupPdf([{ sourceId: 'doc', bytes: doc }], refs, {
      pageWidthPt: 200, pageHeightPt: 200, rows: 2, cols: 2,
      marginPt: { top: 0, right: 0, bottom: 0, left: 0 }, spacingPt: { row: 0, col: 0 },
      fillOrder: 'linhas', cellFit: 'contain', showCutMarks: false, showBorder: false,
    });

    const out = await PDFDocument.load(result.bytes);
    expect(out.getPageCount()).toBe(2);
  });

  it('avisa e não gera folha em branco quando a grade não cabe', async () => {
    const doc = await makeFixture([[10, 10]]);
    const result = await buildNupPdf([{ sourceId: 'doc', bytes: doc }], [{ sourceId: 'doc', sourcePageIndex: 0, rotationCw: 0 }], {
      pageWidthPt: 20, pageHeightPt: 20, rows: 10, cols: 10,
      marginPt: { top: 0, right: 0, bottom: 0, left: 0 }, spacingPt: { row: 5, col: 5 },
      fillOrder: 'linhas', cellFit: 'contain', showCutMarks: false, showBorder: false,
    });
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.bytes.byteLength).toBe(0);
  });

  it('páginas sem /Contents viram aviso por célula, sem derrubar a folha inteira (regressão)', async () => {
    const doc = await makeBlankFixture([[10, 10], [10, 10], [10, 10], [10, 10]]);
    const refs = Array.from({ length: 4 }, (_, i) => ({ sourceId: 'doc', sourcePageIndex: i, rotationCw: 0 as const }));

    const result = await buildNupPdf([{ sourceId: 'doc', bytes: doc }], refs, {
      pageWidthPt: 200, pageHeightPt: 200, rows: 2, cols: 2,
      marginPt: { top: 0, right: 0, bottom: 0, left: 0 }, spacingPt: { row: 0, col: 0 },
      fillOrder: 'linhas', cellFit: 'contain', showCutMarks: false, showBorder: false,
    });

    expect(result.warnings).toHaveLength(4);
    const out = await PDFDocument.load(result.bytes);
    expect(out.getPageCount()).toBe(1);
  });
});

describe('buildPdfFromImages', () => {
  it('embute uma imagem PNG por página no tamanho original', async () => {
    const png = Uint8Array.from(atob(ONE_PX_PNG_BASE64), c => c.charCodeAt(0));
    const bytes = await buildPdfFromImages(
      [{ bytes: png, mime: 'image/png', widthPt: 72, heightPt: 72 }],
      { onePerPage: true, gridRows: 1, gridCols: 1, pageWidthPt: mmToPt(210), pageHeightPt: mmToPt(297), marginPt: { top: 0, right: 0, bottom: 0, left: 0 }, fitMode: 'contain', fitToPage: false }
    );
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(1);
    expect(out.getPage(0).getSize()).toEqual({ width: 72, height: 72 });
  });

  it('várias imagens por folha (grade)', async () => {
    const png = Uint8Array.from(atob(ONE_PX_PNG_BASE64), c => c.charCodeAt(0));
    const images = Array.from({ length: 4 }, () => ({ bytes: png, mime: 'image/png' as const, widthPt: 72, heightPt: 72 }));
    const bytes = await buildPdfFromImages(images, {
      onePerPage: false, gridRows: 2, gridCols: 2,
      pageWidthPt: mmToPt(210), pageHeightPt: mmToPt(297),
      marginPt: { top: 20, right: 20, bottom: 20, left: 20 }, fitMode: 'contain', fitToPage: true,
    });
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(1);
  });
});

describe('optimizeConservative', () => {
  it('nunca promete redução — só relata os dois tamanhos reais', async () => {
    const doc = await PDFDocument.create();
    doc.setTitle('Título de teste');
    doc.addPage([100, 100]);
    const bytes = await doc.save();

    const result = await optimizeConservative(bytes, true);
    expect(result.originalSizeBytes).toBe(bytes.byteLength);
    expect(result.optimizedSizeBytes).toBe(result.bytes.byteLength);

    const reloaded = await PDFDocument.load(result.bytes);
    expect(reloaded.getTitle()).toBe('');
  });
});

describe('getPdfLibPageCount', () => {
  it('conta páginas corretamente', async () => {
    const doc = await makeFixture([[10, 10], [20, 20], [30, 30]]);
    expect(await getPdfLibPageCount(doc)).toBe(3);
  });
});
