import { describe, expect, it } from 'vitest';
import {
  AZ2027_TERREO, EXPEDICAO, LARGURA_DO_PREDIO, PROFUNDIDADE_DA_FILEIRA,
  blocosDaPlanta, comprimentoTotal, posicoesEmX,
} from '../warehouse3dPlantaFisica';

describe('warehouse3dPlantaFisica - geometria lida da planta AZ 2027', () => {
  it('o conjunto tem os 45,2 m da planta', () => {
    expect(comprimentoTotal()).toBeCloseTo(45.2, 2);
  });

  it('nenhuma fileira do predio atual atravessa a parede', () => {
    const xs = posicoesEmX(AZ2027_TERREO[0]);
    const meia = PROFUNDIDADE_DA_FILEIRA / 2;
    expect(xs).toHaveLength(5);
    expect(Math.min(...xs) - meia).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs) + meia).toBeLessThanOrEqual(LARGURA_DO_PREDIO);
  });

  it('o galpao novo poe duas fileiras costa-a-costa no meio', () => {
    const xs = posicoesEmX(AZ2027_TERREO[1]);
    expect(xs).toHaveLength(4);
    // As duas do meio ficam encostadas: distancia entre centros = a propria profundidade.
    expect(xs[2] - xs[1]).toBeCloseTo(PROFUNDIDADE_DA_FILEIRA, 3);
    // E os corredores das pontas valem os 2,65 m cotados na planta.
    const corredor = AZ2027_TERREO[1].corredorLongitudinal;
    expect(xs[1] - xs[0] - PROFUNDIDADE_DA_FILEIRA).toBeCloseTo(corredor, 3);
    expect(xs[3] - xs[2] - PROFUNDIDADE_DA_FILEIRA).toBeCloseTo(corredor, 3);
  });

  it('nenhuma fileira do galpao novo atravessa a parede', () => {
    const xs = posicoesEmX(AZ2027_TERREO[1]);
    const meia = PROFUNDIDADE_DA_FILEIRA / 2;
    expect(Math.min(...xs) - meia).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs) + meia).toBeLessThanOrEqual(LARGURA_DO_PREDIO);
  });

  it('as fileiras respeitam o corredor transversal de entrada de cada trecho', () => {
    for (const trecho of AZ2027_TERREO) {
      const blocos = blocosDaPlanta([trecho], {});
      const fileiras = blocos.filter(b => b.tipo === 'fileira');
      for (const f of fileiras) {
        const zComeco = f.centro[2] - f.tamanho[2] / 2;
        expect(zComeco).toBeCloseTo(trecho.zInicio + trecho.corredorInicio, 3);
      }
    }
  });

  it('as fileiras nao invadem a expedicao', () => {
    const blocos = blocosDaPlanta();
    const exp = blocos.find(b => b.tipo === 'expedicao')!;
    const zExpedicaoComeca = exp.centro[2] - exp.tamanho[2] / 2;
    for (const f of blocos.filter(b => b.tipo === 'fileira')) {
      expect(f.centro[2] + f.tamanho[2] / 2).toBeLessThanOrEqual(zExpedicaoComeca);
    }
  });

  it('a expedicao tem as medidas cotadas e fica rente ao chao', () => {
    const exp = blocosDaPlanta().find(b => b.tipo === 'expedicao')!;
    expect(exp.tamanho[0]).toBeCloseTo(EXPEDICAO.largura, 3);
    expect(exp.tamanho[2]).toBeCloseTo(EXPEDICAO.comprimento, 3);
    expect(exp.centro[1]).toBeLessThan(0.1);
  });

  it('entrega 9 fileiras, rotuladas de A a H na ordem do eixo X', () => {
    const fileiras = blocosDaPlanta().filter(b => b.tipo === 'fileira');
    expect(fileiras).toHaveLength(9);
    const comRotulo = fileiras.filter(f => f.rotulo).map(f => f.rotulo);
    expect(comRotulo).toEqual(['RUA A', 'RUA B', 'RUA C', 'RUA D', 'RUA E', 'RUA F', 'RUA G', 'RUA H']);
    // A quinta fileira do predio atual existe na planta e nao tem rua cadastrada: fica
    // sem rotulo em vez de receber um nome inventado.
    expect(fileiras.filter(f => !f.rotulo)).toHaveLength(1);
  });

  it('duas fileiras nunca se sobrepoem', () => {
    const fileiras = blocosDaPlanta().filter(b => b.tipo === 'fileira');
    for (let i = 0; i < fileiras.length; i++) {
      for (let j = i + 1; j < fileiras.length; j++) {
        const a = fileiras[i], b = fileiras[j];
        const sobrepoeX = Math.abs(a.centro[0] - b.centro[0]) < (a.tamanho[0] + b.tamanho[0]) / 2 - 1e-6;
        const sobrepoeZ = Math.abs(a.centro[2] - b.centro[2]) < (a.tamanho[2] + b.tamanho[2]) / 2 - 1e-6;
        expect(sobrepoeX && sobrepoeZ).toBe(false);
      }
    }
  });
});
