// Cerca e colisão da caminhada.
//
// O que está em jogo: uma colisão que trava os dois eixos juntos faz a pessoa GRUDAR na
// estante ao encostar de lado, e uma cerca errada ou solta a deixa andando para fora do
// galpão. Nenhum dos dois dá erro — os dois só fazem o modo de caminhar parecer quebrado.
//
// Os números vêm da planta real: corredor de 1,20 m no prédio atual e de 2,65 m no galpão
// novo, com a dupla central costa-a-costa (corredor 0).

import { describe, expect, it } from 'vitest';
import {
  bate, caixaDoBloco, caixasDaPlanta, cercaDaPlanta, cercaDeContorno, deslizar, naCerca,
  folgaNoPonto, pontoDeEntrada, type CaixaPlana,
} from '../warehouse3dColisao';
import {
  LARGURA_DO_PREDIO, blocosDaPlanta, comprimentoTotal, mesasDaPlanta,
} from '../warehouse3dPlantaFisica';
import { offsetDaPlanta } from '../warehouse3dCoordenadas';

const RAIO = 0.3;
const SEM_OFFSET = [0, 0, 0] as const;

const caixa = (x0: number, x1: number, z0: number, z1: number): CaixaPlana => ({ x0, x1, z0, z1 });

describe('caixaDoBloco', () => {
  it('converte centro+tamanho em retângulo, já com o offset', () => {
    const c = caixaDoBloco(
      { tipo: 'fileira', centro: [5, 2.1, 10], tamanho: [1.1, 4.2, 15] },
      [-5.15, 0, -22.6],
    );
    expect(c.x0).toBeCloseTo(-0.7, 6);
    expect(c.x1).toBeCloseTo(0.4, 6);
    expect(c.z0).toBeCloseTo(-20.1, 6);
    expect(c.z1).toBeCloseTo(-5.1, 6);
  });
});

describe('caixasDaPlanta', () => {
  const blocos = blocosDaPlanta();
  const mesas = mesasDaPlanta();
  const offset = offsetDaPlanta(LARGURA_DO_PREDIO, comprimentoTotal());

  it('barra fileira e mesa, e NÃO barra a demarcação de expedição', () => {
    // Expedição é tinta no chão, com 4 cm de altura: barrar ali trancaria a pessoa fora
    // justamente da área de carga.
    const fileiras = blocos.filter(b => b.tipo === 'fileira').length;
    expect(blocos.some(b => b.tipo === 'expedicao')).toBe(true);
    expect(caixasDaPlanta(blocos, mesas, offset)).toHaveLength(fileiras + mesas.length);
  });

  it('as 9 fileiras cabem dentro da cerca do prédio', () => {
    const cerca = cercaDaPlanta(LARGURA_DO_PREDIO, comprimentoTotal(), offset);
    for (const c of caixasDaPlanta(blocos, [], offset)) {
      expect(c.x0).toBeGreaterThanOrEqual(cerca.x0 - 1e-9);
      expect(c.x1).toBeLessThanOrEqual(cerca.x1 + 1e-9);
      expect(c.z0).toBeGreaterThanOrEqual(cerca.z0 - 1e-9);
      expect(c.z1).toBeLessThanOrEqual(cerca.z1 + 1e-9);
    }
  });
});

describe('cercaDaPlanta e cercaDeContorno', () => {
  it('a cerca é o PRÉDIO, não o cenário', () => {
    // O cenário é um caixote de `extensao × 1,9` (meio-lado 42,94 m). A cerca antiga era
    // ±45,2 nos dois eixos — 8,8 vezes a meia-largura real em X.
    const c = cercaDaPlanta(10.3, 45.2, [-5.15, 0, -22.6]);
    expect(c.x0).toBeCloseTo(-5.15, 6);
    expect(c.x1).toBeCloseTo(5.15, 6);
    expect(c.z0).toBeCloseTo(-22.6, 6);
    expect(c.z1).toBeCloseTo(22.6, 6);
    expect(c.x1 - c.x0).toBeCloseTo(10.3, 6);
  });

  it('a margem encolhe o retângulo nos dois lados', () => {
    const c = cercaDaPlanta(10, 40, SEM_OFFSET, 0.2);
    expect(c.x0).toBeCloseTo(0.2, 6);
    expect(c.x1).toBeCloseTo(9.8, 6);
  });

  it('o contorno da vista por código ganha folga para o corredor de manobra', () => {
    const c = cercaDeContorno(28, 19.5, SEM_OFFSET, 2);
    expect(c.x0).toBe(-2);
    expect(c.x1).toBe(30);
  });
});

describe('bate e naCerca', () => {
  const c = caixa(0, 2, 0, 2);

  it('conta o raio do caminhante, não só o ponto', () => {
    expect(bate(2.1, 1, c, RAIO)).toBe(true);
    expect(bate(2.4, 1, c, RAIO)).toBe(false);
  });

  it('naCerca prende o ponto para dentro, descontando o raio', () => {
    expect(naCerca(-99, 99, caixa(0, 10, 0, 10), RAIO)).toEqual([0.3, 9.7]);
  });
});

describe('deslizar', () => {
  // Uma fileira em X de 0 a 1,1 — a profundidade real de um porta-pallets.
  const fileira = caixa(0, 1.1, -10, 10);
  const cerca = caixa(-20, 20, -20, 20);

  it('barra o avanço que entra na fileira', () => {
    const [x] = deslizar([-1, 0], [0.5, 0], [fileira], cerca, RAIO);
    expect(x).toBe(-1);
  });

  it('DESLIZA: a componente que não bateu passa', () => {
    // É o ponto do eixo a eixo. Travando os dois juntos, andar colado na estante prende a
    // pessoa a cada toque de ombro.
    const [x, z] = deslizar([-0.5, 0], [0.5, 2], [fileira], cerca, RAIO);
    expect(x).toBe(-0.5);
    expect(z).toBe(2);
  });

  it('passa livre quando não há nada no caminho', () => {
    expect(deslizar([-5, 0], [-4, 1], [fileira], cerca, RAIO)).toEqual([-4, 1]);
  });

  it('não deixa cortar a QUINA na diagonal', () => {
    const bloco = caixa(0, 2, 0, 2);
    const [x, z] = deslizar([-0.5, -0.5], [0.5, 0.5], [bloco], cerca, RAIO);
    expect(bate(x, z, bloco, RAIO)).toBe(false);
  });

  it('prende na cerca mesmo sem obstáculo', () => {
    const [x, z] = deslizar([19, 19], [25, 25], [], cerca, RAIO);
    expect(x).toBeCloseTo(19.7, 6);
    expect(z).toBeCloseTo(19.7, 6);
  });

  it('origem DENTRO de uma caixa libera o movimento, em vez de prender', () => {
    // Estante construída em cima da pessoa, ou entrada mal escolhida: recusar aqui a
    // trancaria para sempre, sem nada na tela explicando.
    const [x] = deslizar([0.5, 0], [2, 0], [fileira], cerca, RAIO);
    expect(x).toBe(2);
  });

  it('o corredor de 1,20 m da planta continua passável com raio de 0,30', () => {
    // Duas fileiras com 1,20 m entre elas: a pessoa anda pelo meio.
    const esquerda = caixa(0, 1.1, -10, 10);
    const direita = caixa(2.3, 3.4, -10, 10);
    const meio = (1.1 + 2.3) / 2;
    const [, z] = deslizar([meio, 0], [meio, 3], [esquerda, direita], cerca, RAIO);
    expect(z).toBe(3);
  });

  it('e o corredor de 0,50 m NÃO é passável — o raio é levado a sério', () => {
    const esquerda = caixa(0, 1.1, -10, 10);
    const direita = caixa(1.6, 2.7, -10, 10);
    const meio = (1.1 + 1.6) / 2;
    expect(bate(meio, 0, esquerda, RAIO) || bate(meio, 0, direita, RAIO)).toBe(true);
  });
});

describe('pontoDeEntrada', () => {
  const cerca = caixa(-5, 5, -5, 5);

  it('devolve o preferido quando ele já está livre', () => {
    expect(pontoDeEntrada([0, 0], [], cerca, RAIO)).toEqual([0, 0]);
  });

  it('acha o ponto livre mais próximo quando o preferido está dentro de geometria', () => {
    // Sem isto a caminhada começaria dentro da estante: a pessoa aperta W e nada acontece.
    const bloco = caixa(-1, 1, -1, 1);
    const [x, z] = pontoDeEntrada([0, 0], [bloco], cerca, RAIO);
    expect(bate(x, z, bloco, RAIO)).toBe(false);
  });

  it('com o galpão inteiro bloqueado, devolve o preferido em vez de travar', () => {
    const tudo = caixa(-99, 99, -99, 99);
    expect(pontoDeEntrada([0, 0], [tudo], cerca, RAIO)).toEqual([0, 0]);
  });

  it('não basta estar LIVRE: a entrada exige folga para andar', () => {
    // Medido na planta real: o centro da expedição está livre e a 0,5 m de uma baia de
    // pallets. A pessoa entrava e travava no primeiro passo, sem nada explicando.
    // Corredor apertado em z < 0 e piso aberto em z > 2: a entrada tem de preferir o
    // aberto, mesmo o apertado estando mais perto do ponto pedido.
    const corredorApertado = [caixa(-5, -0.4, -5, 0), caixa(0.4, 5, -5, 0)];
    expect(folgaNoPonto(0, -1, corredorApertado)).toBeLessThan(0.9);

    const [, z] = pontoDeEntrada([0, -1], corredorApertado, cerca, RAIO);
    expect(z).toBeGreaterThan(0.9);
  });

  it('e quando NÃO existe ponto folgado, aceita o só-livre em vez de desistir', () => {
    // Galpão tão cheio que não sobra um metro em lugar nenhum: melhor entrar apertado do
    // que não entrar.
    const vedado = [caixa(-5, -0.4, -5, 5), caixa(0.4, 5, -5, 5)];
    const [x, z] = pontoDeEntrada([0, 0], vedado, cerca, RAIO);
    expect(bate(x, z, vedado[0], RAIO)).toBe(false);
    expect(bate(x, z, vedado[1], RAIO)).toBe(false);
  });

  it('o ponto devolvido está sempre dentro da cerca', () => {
    const [x, z] = pontoDeEntrada([999, -999], [], cerca, RAIO);
    expect(x).toBeLessThanOrEqual(cerca.x1 - RAIO + 1e-9);
    expect(z).toBeGreaterThanOrEqual(cerca.z0 + RAIO - 1e-9);
  });
});

describe('a planta real: a entrada nasce livre', () => {
  it('o ponto de entrada do galpão AZ 2027 não cai dentro de fileira nem de mesa', () => {
    const blocos = blocosDaPlanta();
    const mesas = mesasDaPlanta();
    const offset = offsetDaPlanta(LARGURA_DO_PREDIO, comprimentoTotal());
    const caixas = caixasDaPlanta(blocos, mesas, offset);
    const cerca = cercaDaPlanta(LARGURA_DO_PREDIO, comprimentoTotal(), offset, 0.2);

    const preferido: [number, number] = [
      (cerca.x0 + cerca.x1) / 2,
      cerca.z0 + (cerca.z1 - cerca.z0) * 0.92,
    ];
    const [x, z] = pontoDeEntrada(preferido, caixas, cerca, RAIO);
    for (const c of caixas) expect(bate(x, z, c, RAIO)).toBe(false);
  });
});

describe('folgaNoPonto', () => {
  it('mede a distancia ate o obstaculo mais proximo', () => {
    const c = { x0: 0, x1: 2, z0: 0, z1: 2 };
    expect(folgaNoPonto(3, 1, [c])).toBeCloseTo(1, 6);
    expect(folgaNoPonto(1, 1, [c])).toBe(0);
  });

  it('sem obstaculo nenhum, a folga e infinita', () => {
    // Importa para a vista por codigo sem vaga cadastrada: ali nao ha caixa, e a entrada
    // nao pode sair varrendo o galpao inteiro atras de folga que ja existe.
    expect(folgaNoPonto(0, 0, [])).toBe(Infinity);
  });
});
