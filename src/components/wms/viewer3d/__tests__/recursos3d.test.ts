// Os recursos de GPU da cena: capacidade dos lotes e materiais por tema.
//
// O que está em jogo aqui não aparece na tela — aparece no custo. A capacidade de um
// `InstancedMesh` vai no construtor e não cresce: alocada no tamanho exato, qualquer vaga
// que troque de status recria o objeto de GPU dos dois lotes envolvidos. E material
// compartilhado mutado por efeito funciona até o dia em que dois componentes coexistem.

import { describe, expect, it } from 'vitest';
import { MATERIAIS_DA_ESTRUTURA, capacidadeDoLote } from '../recursos3d';
import { COR_COLUNA, COR_PALETE, COR_TRAVESSA } from '../aparencia';

describe('capacidadeDoLote', () => {
  it('lote vazio já nasce com um bloco', () => {
    // `new InstancedMesh(..., 0)` é válido, mas obrigaria a remontar no instante em que a
    // primeira instância aparecesse — justamente o que a folga existe para evitar.
    expect(capacidadeDoLote(0)).toBe(64);
  });

  it('a contagem varia DENTRO do bloco sem mudar a capacidade', () => {
    // É o ponto: 7 vagas ocupadas viram 8, e o objeto de GPU sobrevive.
    expect(capacidadeDoLote(1)).toBe(64);
    expect(capacidadeDoLote(7)).toBe(64);
    expect(capacidadeDoLote(8)).toBe(64);
    expect(capacidadeDoLote(64)).toBe(64);
  });

  it('cresce em blocos, nunca abaixo do necessário', () => {
    expect(capacidadeDoLote(65)).toBe(128);
    expect(capacidadeDoLote(128)).toBe(128);
    expect(capacidadeDoLote(129)).toBe(192);
    expect(capacidadeDoLote(303)).toBe(320);
  });

  it('a capacidade NUNCA é menor que a quantidade — senão a instância não desenha', () => {
    for (let n = 0; n <= 400; n++) expect(capacidadeDoLote(n)).toBeGreaterThanOrEqual(n);
  });

  it('o tamanho do bloco é ajustável, para quem precisar de outro compromisso', () => {
    expect(capacidadeDoLote(10, 4)).toBe(12);
    expect(capacidadeDoLote(4, 4)).toBe(4);
  });

  it('os lotes reais da planta cabem em poucos blocos', () => {
    // 303 vãos e 604 peças de estrutura, medidos no térreo.
    expect(capacidadeDoLote(303) / 64).toBeLessThanOrEqual(5);
    expect(capacidadeDoLote(604) / 64).toBeLessThanOrEqual(10);
  });
});

describe('MATERIAIS_DA_ESTRUTURA', () => {
  it('cada tema tem o PRÓPRIO conjunto, e eles não são o mesmo objeto', () => {
    // A garantia que a mutação não dava: nenhum componente pode pintar o aço de outro.
    expect(MATERIAIS_DA_ESTRUTURA.light.coluna).not.toBe(MATERIAIS_DA_ESTRUTURA.dark.coluna);
    expect(MATERIAIS_DA_ESTRUTURA.light.travessa).not.toBe(MATERIAIS_DA_ESTRUTURA.dark.travessa);
    expect(MATERIAIS_DA_ESTRUTURA.light.palete).not.toBe(MATERIAIS_DA_ESTRUTURA.dark.palete);
  });

  it('a cor de cada material é a do seu tema', () => {
    expect(`#${MATERIAIS_DA_ESTRUTURA.light.coluna.color.getHexString().toUpperCase()}`)
      .toBe(COR_COLUNA.light.toUpperCase());
    expect(`#${MATERIAIS_DA_ESTRUTURA.dark.travessa.color.getHexString().toUpperCase()}`)
      .toBe(COR_TRAVESSA.dark.toUpperCase());
    expect(`#${MATERIAIS_DA_ESTRUTURA.dark.palete.color.getHexString().toUpperCase()}`)
      .toBe(COR_PALETE.dark.toUpperCase());
  });

  it('o palete atenuado é a MESMA madeira, só translúcida', () => {
    for (const tema of ['light', 'dark'] as const) {
      const { palete, paleteAtenuado } = MATERIAIS_DA_ESTRUTURA[tema];
      expect(paleteAtenuado.color.getHexString()).toBe(palete.color.getHexString());
      expect(paleteAtenuado.transparent).toBe(true);
      expect(paleteAtenuado.opacity).toBeCloseTo(0.45, 6);
      // `depthWrite: false` pelo mesmo motivo do raio-X: num lote só, o translúcido da
      // frente recortaria o que está atrás dele.
      expect(paleteAtenuado.depthWrite).toBe(false);
      expect(palete.transparent).toBe(false);
    }
  });

  it('o aço não é translúcido em tema nenhum', () => {
    for (const tema of ['light', 'dark'] as const) {
      expect(MATERIAIS_DA_ESTRUTURA[tema].coluna.transparent).toBe(false);
      expect(MATERIAIS_DA_ESTRUTURA[tema].travessa.transparent).toBe(false);
    }
  });
});
