// O resolvedor de coordenadas por vista.
//
// O teste central deste arquivo é o último: provar que as duas geometrias DIVERGEM. Se
// elas coincidissem, o resolvedor seria cerimônia — e foi justamente a suposição de que
// coincidiam que fez a câmera voar para o lugar errado durante semanas.

import { describe, expect, it } from 'vitest';
import {
  cabeceiraDaPlanta, emMundo, indiceDosVaos, offsetDaPlanta,
  recuoDeFoco, resolvedorDaGrade, resolvedorDaPlanta,
} from '../warehouse3dCoordenadas';
import { LAYOUT_PADRAO, posicaoDaVaga } from '../warehouse3dLayout';
import {
  LARGURA_DO_PREDIO, NIVEIS_POR_FILEIRA, blocosDaPlanta, comprimentoTotal, posicoesDaFileira,
} from '../warehouse3dPlantaFisica';
import type { Slot } from '../warehouse3dSlots';

const vaga = (id: string, rua: number, ruaCodigo: string, modulo: number, nivel: number): Slot => ({
  id, rua, ruaCodigo, modulo, nivel, status: 'occupied', caixas: 1, capacidade: null,
});

const blocos = blocosDaPlanta();
const fileiras = blocos.filter(b => b.tipo === 'fileira');

describe('emMundo e offsetDaPlanta', () => {
  it('soma componente a componente', () => {
    expect(emMundo([1, 2, 3], [10, 20, 30])).toEqual([11, 22, 33]);
  });

  it('o offset da planta centra o ENVELOPE do prédio na origem', () => {
    expect(offsetDaPlanta(10.3, 45.2)).toEqual([-5.15, 0, -22.6]);
  });
});

describe('indiceDosVaos', () => {
  it('indexa um vão por posição e nível de cada fileira com rua', () => {
    const indice = indiceDosVaos(blocos);
    const esperado = fileiras
      .filter(b => /^RUA\s+[A-Z]+$/.test(b.rotulo))
      .reduce((total, b) => total + posicoesDaFileira(b) * NIVEIS_POR_FILEIRA, 0);
    expect(indice.size).toBe(esperado);
    expect(esperado).toBeGreaterThan(0);
  });

  it('usa o MESMO formato de código que a vaga cadastrada', () => {
    const indice = indiceDosVaos(blocos);
    // Se o formato divergisse, o índice existiria e nunca casaria com endereço nenhum —
    // o resolvedor devolveria null para tudo e a câmera simplesmente não se mexeria.
    expect(indice.has('PP-E01-N1')).toBe(true);
    for (const chave of indice.keys()) expect(chave).toMatch(/^PP-[A-Z]+\d{2}-N\d+$/);
  });

  it('acompanha o CADASTRO: a posição 13 da rua A só existe quando ela é informada', () => {
    // A planta desenha 8 posições para a rua A (10,5 m ÷ 1,2); o cadastro tem 13. Quem
    // estica a fileira é `blocosDaPlanta`, e o índice tem de acompanhar — senão a câmera
    // não acha justamente a vaga alta que a mercadoria ocupa.
    expect(indiceDosVaos(blocos).has('PP-A13-N3')).toBe(false);
    expect(indiceDosVaos(blocosDaPlanta(undefined, undefined, { A: 13 })).has('PP-A13-N3')).toBe(true);
  });

  it('respeita o prefixo pedido', () => {
    expect([...indiceDosVaos(blocos, 'XX').keys()].every(k => k.startsWith('XX-'))).toBe(true);
  });

  it('ignora o que não é fileira: expedição não vira endereço', () => {
    const soExpedicao = blocos.filter(b => b.tipo !== 'fileira');
    expect(soExpedicao.length).toBeGreaterThan(0);
    expect(indiceDosVaos(soExpedicao).size).toBe(0);
  });
});

describe('resolvedores', () => {
  it('o da grade devolve a mesma coisa que posicaoDaVaga', () => {
    const alvo = vaga('PP-E03-N2', 5, 'E', 3, 2);
    expect(resolvedorDaGrade(LAYOUT_PADRAO)(alvo)).toEqual(posicaoDaVaga(alvo, LAYOUT_PADRAO));
  });

  it('o da planta devolve null para endereço que ela não desenha', () => {
    const resolver = resolvedorDaPlanta(indiceDosVaos(blocos));
    // Null, e não [0,0,0]: a origem é um canto REAL do galpão, e mandar a câmera para lá
    // como se fosse o endereço pedido é pior que não mover a câmera.
    expect(resolver(vaga('PP-Z99-N9', 26, 'Z', 99, 9))).toBeNull();
    expect(resolver(vaga('PP-E03-N2', 5, 'E', 3, 2))).not.toBeNull();
  });
});

describe('cabeceiraDaPlanta', () => {
  it('fica ANTES da primeira fileira, dentro do corredor de entrada', () => {
    const z = cabeceiraDaPlanta(blocos);
    const primeiroInicio = Math.min(...fileiras.map(b => b.centro[2] - b.tamanho[2] / 2));
    expect(z).toBeLessThan(primeiroInicio);
    // E dentro do prédio: travessia fora dele faria a rota sair pela parede.
    expect(z).toBeGreaterThan(0);
  });

  it('sem fileira devolve 0, e não Infinity', () => {
    // `Math.min()` de lista vazia é Infinity, e uma rota até o infinito não desenha.
    expect(cabeceiraDaPlanta([])).toBe(0);
  });
});

describe('as duas geometrias divergem — é o que justifica o resolvedor', () => {
  it('a mesma vaga cai em lugares diferentes na grade e na planta', () => {
    const alvo = vaga('PP-E03-N2', 5, 'E', 3, 2);

    const naGrade = emMundo(posicaoDaVaga(alvo, LAYOUT_PADRAO), [-14, 0, -9.75]);
    const local = indiceDosVaos(blocos).get(alvo.id)!.centro;
    const naPlanta = emMundo(local, offsetDaPlanta(LARGURA_DO_PREDIO, comprimentoTotal()));

    const distancia = Math.hypot(
      naGrade[0] - naPlanta[0],
      naGrade[1] - naPlanta[1],
      naGrade[2] - naPlanta[2],
    );
    // Medido em produção: ~10,6 m. O limite é frouxo de propósito — o que o teste afirma
    // é que NÃO são a mesma coordenada, não um valor exato que a planta pode corrigir.
    expect(distancia).toBeGreaterThan(5);
  });

  it('e nem a escala dos eixos bate: 8 ruas em 28 m contra 10,3 m', () => {
    const larguraDaGrade = (8 - 1) * LAYOUT_PADRAO.rowSpacing;
    expect(larguraDaGrade).toBe(28);
    expect(LARGURA_DO_PREDIO).toBeLessThan(larguraDaGrade / 2);
    // Por isso não existe offset que converta uma geometria na outra.
  });
});

describe('recuoDeFoco', () => {
  const cfg = { rowSpacing: LAYOUT_PADRAO.rowSpacing, moduleWidth: LAYOUT_PADRAO.moduleWidth };

  it('na grade por codigo, recua pelo espacamento de rua', () => {
    expect(recuoDeFoco(cfg, false)).toBeCloseTo(8.8, 6);
  });

  it('na planta, recua MUITO menos — senao a camera entra na estante vizinha', () => {
    // Corredor de 2,65 m no galpao novo e de 1,20 m no predio atual: 8,8 m de recuo poe a
    // camera duas fileiras adiante, dentro do aco.
    const naPlanta = recuoDeFoco(cfg, true);
    expect(naPlanta).toBeLessThan(recuoDeFoco(cfg, false) / 3);
    expect(naPlanta).toBeCloseTo(Math.max(1.1, 1.2) * 2.2, 6);
  });

  it('nunca e zero, qualquer que seja a vista', () => {
    // Recuo zero coloca a camera dentro da propria vaga que ela foi mostrar.
    expect(recuoDeFoco({ rowSpacing: 0, moduleWidth: 0 }, true)).toBeGreaterThan(0);
    expect(recuoDeFoco({ rowSpacing: 1.2, moduleWidth: 1.2 }, false)).toBeGreaterThan(0);
  });
});
