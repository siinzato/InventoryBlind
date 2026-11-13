// Geometria configurável do porta-pallets, conferida sem WebGL.
//
// O que está em jogo: uma estrutura aérea desenhada no chão faz quem planeja separação
// achar que alcança sem equipamento o que está a três metros. Screenshot não distingue
// 2,5 m de 2,4 m; estes testes distinguem.

import { describe, it, expect } from 'vitest';
import {
  LAYOUT_PADRAO, LIMITES, VAGA,
  baseDaRua, posicaoDaVaga, sanearLayout,
} from '../warehouse3dLayout';

const vaga = (over: Partial<{ rua: number; ruaCodigo: string; modulo: number; nivel: number }> = {}) => ({
  rua: 1, ruaCodigo: 'A', modulo: 1, nivel: 1, ...over,
});

describe('posicaoDaVaga', () => {
  it('a BASE do nível 1 encosta em baseOffsetY, não o centro', () => {
    // Esta é a definição da medida para quem olha a estrutura no galpão. Se o centro
    // ficasse em baseOffsetY, metade da vaga ficaria enterrada no piso.
    const cfg = { ...LAYOUT_PADRAO, baseOffsetY: 3 };
    const [, y] = posicaoDaVaga(vaga({ nivel: 1 }), cfg);
    expect(y - VAGA.altura / 2).toBe(3);
  });

  it('no padrão (base 0) o nível 1 fica apoiado no chão', () => {
    const [, y] = posicaoDaVaga(vaga({ nivel: 1 }), LAYOUT_PADRAO);
    expect(y - VAGA.altura / 2).toBe(0);
  });

  it('cada nível sobe exatamente levelHeight', () => {
    const cfg = { ...LAYOUT_PADRAO, levelHeight: 2.0 };
    const y1 = posicaoDaVaga(vaga({ nivel: 1 }), cfg)[1];
    const y3 = posicaoDaVaga(vaga({ nivel: 3 }), cfg)[1];
    expect(y3 - y1).toBeCloseTo(4.0, 10);
  });

  it('rua anda em X por rowSpacing e módulo anda em Z por moduleWidth', () => {
    const cfg = { ...LAYOUT_PADRAO, rowSpacing: 4, moduleWidth: 1.3 };
    expect(posicaoDaVaga(vaga({ rua: 3 }), cfg)[0]).toBeCloseTo(8, 10);
    expect(posicaoDaVaga(vaga({ modulo: 5 }), cfg)[2]).toBeCloseTo(5.2, 10);
  });

  it('a elevação própria de uma rua sobrepõe a geral', () => {
    const cfg = { ...LAYOUT_PADRAO, baseOffsetY: 0, baseByStreet: { B: 2.5 } };
    expect(posicaoDaVaga(vaga({ ruaCodigo: 'A' }), cfg)[1] - VAGA.altura / 2).toBe(0);
    expect(posicaoDaVaga(vaga({ ruaCodigo: 'B' }), cfg)[1] - VAGA.altura / 2).toBe(2.5);
  });

  it('os padrões reproduzem o desenho anterior — abrir o configurador e nao mexer nao move nada', () => {
    // 1,8 de passo de nível e 4,0 de rua eram constantes fixas antes de virarem config.
    expect(LAYOUT_PADRAO.levelHeight).toBe(1.8);
    expect(LAYOUT_PADRAO.rowSpacing).toBe(4.0);
    expect(LAYOUT_PADRAO.moduleWidth).toBe(1.3);
    expect(LAYOUT_PADRAO.baseOffsetY).toBe(0);
  });
});

describe('baseDaRua', () => {
  it('não diferencia maiúscula de minúscula — a letra vem do código da vaga', () => {
    const cfg = { ...LAYOUT_PADRAO, baseByStreet: { C: 1.5 } };
    expect(baseDaRua('c', cfg)).toBe(1.5);
    expect(baseDaRua('C', cfg)).toBe(1.5);
  });

  it('rua sem elevação própria cai na geral', () => {
    expect(baseDaRua('Z', { ...LAYOUT_PADRAO, baseOffsetY: 4 })).toBe(4);
  });
});

describe('sanearLayout', () => {
  it('lixo no localStorage devolve o padrão em vez de quebrar a tela', () => {
    expect(sanearLayout(null)).toEqual(LAYOUT_PADRAO);
    expect(sanearLayout('nao sou objeto')).toEqual(LAYOUT_PADRAO);
    expect(sanearLayout(42)).toEqual(LAYOUT_PADRAO);
  });

  it('campo ausente ou do tipo errado volta ao padrão, sem contaminar os outros', () => {
    const saneado = sanearLayout({ levelHeight: 'alto', baseOffsetY: 2.5 });
    expect(saneado.levelHeight).toBe(LAYOUT_PADRAO.levelHeight);
    expect(saneado.baseOffsetY).toBe(2.5);
  });

  it('nível mais baixo que a vaga é impossível — os andares se atravessariam', () => {
    expect(sanearLayout({ levelHeight: 0.2 }).levelHeight).toBe(LIMITES.levelHeight.min);
    expect(LIMITES.levelHeight.min).toBe(VAGA.altura);
  });

  it('valor absurdo é preso no limite, não aceito', () => {
    // rowSpacing 500 jogaria a ultima rua para fora do campo de visao sem aviso.
    expect(sanearLayout({ rowSpacing: 500 }).rowSpacing).toBe(LIMITES.rowSpacing.max);
    expect(sanearLayout({ baseOffsetY: -3 }).baseOffsetY).toBe(LIMITES.baseOffsetY.min);
  });

  it('NaN e Infinity nao passam — um NaN no Y some com a vaga da cena', () => {
    expect(sanearLayout({ levelHeight: Number.NaN }).levelHeight).toBe(LAYOUT_PADRAO.levelHeight);
    expect(sanearLayout({ rowSpacing: Number.POSITIVE_INFINITY }).rowSpacing).toBe(LAYOUT_PADRAO.rowSpacing);
  });

  it('elevação por rua tambem e limitada e normalizada para maiuscula', () => {
    const saneado = sanearLayout({ baseByStreet: { b: 99, c: 'alto' } });
    expect(saneado.baseByStreet).toEqual({ B: LIMITES.baseOffsetY.max });
  });
});
