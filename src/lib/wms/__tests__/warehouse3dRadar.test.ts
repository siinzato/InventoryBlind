// A aritmética do radar, verificada sem WebGL.
//
// O que está em jogo: o radar promete dizer PARA ONDE o operador está olhando dentro do
// galpão. Um erro de sinal ou de sistema de coordenadas não quebra nada visivelmente —
// o desenho continua bonito e aponta para o corredor errado. É o tipo de defeito que só
// aritmética conferida pega.

import { describe, it, expect } from 'vitest';
import {
  areaDoRadar, caminhoDoCone, celulasDoRadar, grausDeVisao,
  localParaMundo, meiaAberturaHorizontal, mundoParaLocal, prenderNaArea,
} from '../warehouse3dRadar';
import { LAYOUT_PADRAO } from '../warehouse3dLayout';
import type { Slot } from '../warehouse3dSlots';

const vaga = (over: Partial<Slot> = {}): Slot => ({
  id: 'PP-A01-N1',
  rua: 1,
  ruaCodigo: 'A',
  modulo: 1,
  nivel: 1,
  status: 'occupied',
  caixas: 10,
  capacidade: null,
  ...over,
});

describe('celulasDoRadar', () => {
  it('colapsa os níveis de uma mesma coluna num ponto só', () => {
    const celulas = celulasDoRadar(
      [
        vaga({ id: 'A01-N1', nivel: 1 }),
        vaga({ id: 'A01-N2', nivel: 2 }),
        vaga({ id: 'A01-N3', nivel: 3 }),
      ],
      LAYOUT_PADRAO,
      new Set(),
    );
    expect(celulas).toHaveLength(1);
    expect(celulas[0].niveis).toBe(3);
  });

  it('alerta em QUALQUER nível marca a coluna inteira', () => {
    const celulas = celulasDoRadar(
      [
        vaga({ id: 'A01-N1', nivel: 1, status: 'occupied' }),
        vaga({ id: 'A01-N3', nivel: 3, status: 'divergence' }),
      ],
      LAYOUT_PADRAO,
      new Set(),
    );
    expect(celulas[0].divergencia).toBe(true);
  });

  it('alto giro no nível alto marca a coluna, mesmo chegando depois', () => {
    const celulas = celulasDoRadar(
      [vaga({ id: 'A01-N1', nivel: 1 }), vaga({ id: 'A01-N2', nivel: 2 })],
      LAYOUT_PADRAO,
      new Set(['A01-N2']),
    );
    expect(celulas[0].altoGiro).toBe(true);
  });

  it('coluna sem alerta nenhum não é marcada', () => {
    const celulas = celulasDoRadar([vaga()], LAYOUT_PADRAO, new Set());
    expect(celulas[0].divergencia).toBe(false);
    expect(celulas[0].altoGiro).toBe(false);
  });

  it('usa a MESMA posição que a cena 3D desenha', () => {
    const celulas = celulasDoRadar(
      [vaga({ rua: 3, modulo: 5, nivel: 2 })],
      LAYOUT_PADRAO,
      new Set(),
    );
    expect(celulas[0].x).toBe((3 - 1) * LAYOUT_PADRAO.rowSpacing);
    expect(celulas[0].z).toBe((5 - 1) * LAYOUT_PADRAO.moduleWidth);
  });

  it('devolve as colunas em ordem estável de rua e módulo', () => {
    const celulas = celulasDoRadar(
      [
        vaga({ id: 'b', rua: 2, modulo: 1 }),
        vaga({ id: 'c', rua: 1, modulo: 9 }),
        vaga({ id: 'a', rua: 1, modulo: 2 }),
      ],
      LAYOUT_PADRAO,
      new Set(),
    );
    expect(celulas.map(c => `${c.rua}-${c.modulo}`)).toEqual(['1-2', '1-9', '2-1']);
  });

  it('armazém vazio não quebra', () => {
    expect(celulasDoRadar([], LAYOUT_PADRAO, new Set())).toEqual([]);
  });
});

describe('areaDoRadar', () => {
  it('envolve todas as colunas com folga dos dois lados', () => {
    const celulas = celulasDoRadar(
      [vaga({ id: 'a', rua: 1, modulo: 1 }), vaga({ id: 'b', rua: 3, modulo: 5 })],
      LAYOUT_PADRAO,
      new Set(),
    );
    const area = areaDoRadar(celulas);
    const xs = celulas.map(c => c.x);
    expect(area.minX).toBeLessThan(Math.min(...xs));
    expect(area.minX + area.largura).toBeGreaterThan(Math.max(...xs));
  });

  it('uma coluna só ainda produz área com lado positivo', () => {
    const area = areaDoRadar(celulasDoRadar([vaga()], LAYOUT_PADRAO, new Set()));
    expect(area.largura).toBeGreaterThan(0);
    expect(area.profundidade).toBeGreaterThan(0);
  });

  it('armazém vazio produz área válida em vez de NaN', () => {
    const area = areaDoRadar([]);
    expect(Number.isFinite(area.largura)).toBe(true);
    expect(area.largura).toBeGreaterThan(0);
  });
});

describe('conversão entre mundo e local', () => {
  const deslocamento = [-6, 0, -8] as const;

  it('ida e volta devolve o ponto original', () => {
    const [lx, lz] = mundoParaLocal(2, 3, deslocamento);
    expect(localParaMundo(lx, lz, deslocamento)).toEqual([2, 3]);
  });

  it('o centro do mundo cai no centro do armazém, não na origem do radar', () => {
    // Com o grupo deslocado de -6/-8, a origem do MUNDO é o ponto local (6, 8).
    expect(mundoParaLocal(0, 0, deslocamento)).toEqual([6, 8]);
  });

  it('deslocamento zero torna os dois sistemas iguais', () => {
    expect(mundoParaLocal(4, 7, [0, 0, 0])).toEqual([4, 7]);
  });
});

describe('prenderNaArea', () => {
  const area = { minX: 0, minZ: 0, largura: 10, profundidade: 20 };

  it('não mexe em ponto que já está dentro', () => {
    expect(prenderNaArea(5, 5, area)).toEqual([5, 5]);
  });

  it('traz de volta a câmera afastada muito além do armazém', () => {
    expect(prenderNaArea(900, -900, area)).toEqual([10, 0]);
  });

  it('prende exatamente na borda, não perto dela', () => {
    expect(prenderNaArea(-1, 21, area)).toEqual([0, 20]);
  });
});

describe('grausDeVisao', () => {
  it('olhar para +X é zero grau', () => {
    expect(grausDeVisao(0, 0, 5, 0)).toBe(0);
  });

  it('olhar para +Z é 90 graus — Z cresce para BAIXO na tela', () => {
    expect(grausDeVisao(0, 0, 0, 5)).toBe(90);
  });

  it('olhar para -X é 180 graus', () => {
    expect(Math.abs(grausDeVisao(0, 0, -5, 0))).toBe(180);
  });

  it('olhar para -Z é -90 graus', () => {
    expect(grausDeVisao(0, 0, 0, -5)).toBe(-90);
  });

  it('câmera em cima do alvo devolve 0, nunca NaN', () => {
    expect(grausDeVisao(3, 3, 3, 3)).toBe(0);
  });
});

describe('meiaAberturaHorizontal', () => {
  it('em tela quadrada, a abertura horizontal iguala a vertical', () => {
    const meia = meiaAberturaHorizontal(45, 1);
    expect(meia).toBeCloseTo((45 * Math.PI) / 180 / 2, 10);
  });

  it('tela mais larga abre o cone', () => {
    expect(meiaAberturaHorizontal(45, 2)).toBeGreaterThan(meiaAberturaHorizontal(45, 1));
  });

  it('tela mais estreita fecha o cone', () => {
    expect(meiaAberturaHorizontal(45, 0.5)).toBeLessThan(meiaAberturaHorizontal(45, 1));
  });
});

describe('caminhoDoCone', () => {
  it('começa no vértice e fecha o traçado', () => {
    const d = caminhoDoCone(Math.PI / 6, 10);
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
  });

  it('é simétrico em torno do eixo X', () => {
    const d = caminhoDoCone(Math.PI / 6, 10);
    const ys = [...d.matchAll(/L [\d.-]+ ([\d.-]+)/g)].map(m => Number(m[1]));
    expect(ys[0]).toBeCloseTo(-ys[1], 10);
  });

  it('limita a abertura para o cone não engolir o radar', () => {
    const extremo = caminhoDoCone(Math.PI / 2, 10);
    const noLimite = caminhoDoCone((85 * Math.PI) / 180, 10);
    expect(extremo).toBe(noLimite);
  });

  it('alcance maior produz cone maior', () => {
    const curto = caminhoDoCone(Math.PI / 6, 5);
    const longo = caminhoDoCone(Math.PI / 6, 50);
    expect(curto).not.toBe(longo);
  });
});
