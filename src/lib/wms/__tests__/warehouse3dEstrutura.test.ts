// Geometria da estante, verificada sem WebGL.
//
// O que está em jogo: carga flutuando acima do palete, palete atravessando a viga, ou
// montante no meio do vão em vez da divisa. Nada disso lança erro — produz uma estante
// que parece certa de longe e está errada de perto, e é a única coisa que o operador
// usa para entender em que altura a mercadoria está.

import { describe, it, expect } from 'vitest';
import {
  CARGA, ESTRUTURA, PALETE,
  montantesDoArmazem, pisoDoVao, posicaoDaCarga, posicaoDoPalete, vigasDoArmazem,
} from '../warehouse3dEstrutura';
import { LAYOUT_PADRAO, VAGA, posicaoDaVaga } from '../warehouse3dLayout';
import type { Slot } from '../warehouse3dSlots';

const cfg = LAYOUT_PADRAO;

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

describe('palete e carga', () => {
  it('o palete se apoia no PISO do vão, não no centro dele', () => {
    const v = vaga({ nivel: 2 });
    const piso = pisoDoVao(v, cfg);
    expect(piso).toBe(posicaoDaVaga(v, cfg)[1] - VAGA.altura / 2);
    expect(posicaoDoPalete(v, cfg)[1]).toBeCloseTo(piso + PALETE.altura / 2, 10);
  });

  it('a carga fica SOBRE o palete, sem atravessá-lo', () => {
    const v = vaga({ nivel: 3 });
    const baseDaCarga = posicaoDaCarga(v, cfg)[1] - CARGA.altura / 2;
    const topoDoPalete = posicaoDoPalete(v, cfg)[1] + PALETE.altura / 2;
    expect(baseDaCarga).toBeCloseTo(topoDoPalete, 10);
  });

  it('palete e carga ficam alinhados em X e Z com o centro da vaga', () => {
    const v = vaga({ rua: 3, modulo: 7, nivel: 2 });
    const [x, , z] = posicaoDaVaga(v, cfg);
    expect(posicaoDoPalete(v, cfg)[0]).toBe(x);
    expect(posicaoDoPalete(v, cfg)[2]).toBe(z);
    expect(posicaoDaCarga(v, cfg)[0]).toBe(x);
    expect(posicaoDaCarga(v, cfg)[2]).toBe(z);
  });

  it('o conjunto palete + carga CABE no vão, com folga no topo', () => {
    const v = vaga();
    const topoDaCarga = posicaoDaCarga(v, cfg)[1] + CARGA.altura / 2;
    const tetoDoVao = pisoDoVao(v, cfg) + VAGA.altura;
    expect(topoDaCarga).toBeLessThan(tetoDoVao);
    expect(tetoDoVao - topoDaCarga).toBeCloseTo(ESTRUTURA.folgaTopo, 10);
  });

  it('a carga é mais estreita que o palete, que é mais estreito que o vão', () => {
    expect(CARGA.largura).toBeLessThan(PALETE.largura);
    expect(PALETE.largura).toBeLessThan(VAGA.largura);
    expect(CARGA.profundidade).toBeLessThan(PALETE.profundidade);
    expect(PALETE.profundidade).toBeLessThan(VAGA.profundidade);
  });

  it('nenhuma dimensão é negativa ou zero', () => {
    for (const v of [CARGA.largura, CARGA.profundidade, CARGA.altura, PALETE.altura]) {
      expect(v).toBeGreaterThan(0);
    }
  });

  it('vaga elevada leva palete e carga junto', () => {
    const elevado = { ...cfg, baseByStreet: { A: 3 } };
    const v = vaga();
    expect(posicaoDoPalete(v, elevado)[1]).toBeCloseTo(posicaoDoPalete(v, cfg)[1] + 3, 10);
  });
});

describe('montantesDoArmazem', () => {
  it('fica nas DIVISAS de módulo, não no centro da vaga', () => {
    const pecas = montantesDoArmazem([vaga({ modulo: 1 })], cfg);
    const zs = [...new Set(pecas.map(p => p.posicao[2]))].sort((a, b) => a - b);
    // Módulo 1 tem centro em z=0; as divisas ficam meio módulo antes e depois.
    expect(zs).toEqual([-cfg.moduleWidth / 2, cfg.moduleWidth / 2]);
  });

  it('n módulos produzem n+1 divisas, em duas fileiras', () => {
    const slots = [1, 2, 3].map(m => vaga({ id: 'm' + m, modulo: m }));
    const pecas = montantesDoArmazem(slots, cfg);
    const divisas = new Set(pecas.map(p => p.posicao[2]));
    expect(divisas.size).toBe(4);
    expect(pecas).toHaveLength(8); // 4 divisas x frente e fundo
  });

  it('as duas fileiras ficam na frente e no fundo da profundidade do vão', () => {
    const pecas = montantesDoArmazem([vaga()], cfg);
    const xs = [...new Set(pecas.map(p => p.posicao[0]))].sort((a, b) => a - b);
    expect(xs).toEqual([-VAGA.profundidade / 2, VAGA.profundidade / 2]);
  });

  it('a altura vai da base até o topo do último nível', () => {
    const slots = [vaga({ id: 'a', nivel: 1 }), vaga({ id: 'b', nivel: 3 })];
    const [peca] = montantesDoArmazem(slots, cfg);
    expect(peca.comprimento).toBeCloseTo(3 * cfg.levelHeight, 10);
    // Centro na metade da altura, a partir da base da rua.
    expect(peca.posicao[1]).toBeCloseTo(peca.comprimento / 2, 10);
  });

  it('cada rua tem a própria altura — uma rua baixa não puxa a alta', () => {
    const slots = [
      vaga({ id: 'a', rua: 1, ruaCodigo: 'A', nivel: 1 }),
      vaga({ id: 'b', rua: 2, ruaCodigo: 'B', nivel: 3 }),
    ];
    const alturas = [...new Set(montantesDoArmazem(slots, cfg).map(p => p.comprimento))];
    expect(alturas.sort((a, b) => a - b)).toEqual([cfg.levelHeight, 3 * cfg.levelHeight]);
  });

  it('rua elevada começa na base dela', () => {
    const elevado = { ...cfg, baseByStreet: { A: 2.5 } };
    const [peca] = montantesDoArmazem([vaga()], elevado);
    expect(peca.posicao[1]).toBeCloseTo(2.5 + cfg.levelHeight / 2, 10);
  });

  it('armazém vazio não produz estrutura', () => {
    expect(montantesDoArmazem([], cfg)).toEqual([]);
  });
});

describe('vigasDoArmazem', () => {
  it('uma viga por nível, em duas fileiras', () => {
    const slots = [1, 2, 3].map(n => vaga({ id: 'n' + n, nivel: n }));
    expect(vigasDoArmazem(slots, cfg)).toHaveLength(6); // 3 níveis x frente e fundo
  });

  it('rua de UM nível tem travessa — senão as colunas ficam soltas', () => {
    // Regressão das ruas C e D, que em produção só têm nível 1 e apareceram no mapa
    // como montantes sem nada ligando um ao outro.
    const vigas = vigasDoArmazem([vaga({ nivel: 1 })], cfg);
    expect(vigas).toHaveLength(2);
    expect(vigas[0].posicao[1]).toBeCloseTo(cfg.levelHeight - ESTRUTURA.viga / 2, 10);
  });

  it('nenhuma viga fica enterrada no piso da rua', () => {
    const slots = [1, 2, 3].map(n => vaga({ id: 'n' + n, nivel: n }));
    for (const viga of vigasDoArmazem(slots, cfg)) {
      expect(viga.posicao[1] - ESTRUTURA.viga / 2).toBeGreaterThanOrEqual(0);
    }
  });

  it('o TOPO da viga coincide com o piso do nível de CIMA: é nela que o palete apoia', () => {
    // Medido: com o centro no piso, a viga atravessava os 7 cm de baixo do palete.
    const slots = [1, 2].map(n => vaga({ id: 'n' + n, nivel: n }));
    const pisoDoNivel2 = pisoDoVao(vaga({ nivel: 2 }), cfg);
    const naAlturaCerta = vigasDoArmazem(slots, cfg).filter(
      p => Math.abs(p.posicao[1] + ESTRUTURA.viga / 2 - pisoDoNivel2) < 1e-9,
    );
    expect(naAlturaCerta).toHaveLength(2);
  });

  it('nenhuma viga invade o palete ou a carga de qualquer nível', () => {
    const slots = [1, 2, 3].map(n => vaga({ id: 'n' + n, nivel: n }));
    const vigas = vigasDoArmazem(slots, cfg);
    for (const n of [1, 2, 3]) {
      const v = vaga({ nivel: n });
      const basePalete = posicaoDoPalete(v, cfg)[1] - PALETE.altura / 2;
      const topoCarga = posicaoDaCarga(v, cfg)[1] + CARGA.altura / 2;
      for (const viga of vigas) {
        const base = viga.posicao[1] - ESTRUTURA.viga / 2;
        const topo = viga.posicao[1] + ESTRUTURA.viga / 2;
        // Ou a viga está inteiramente abaixo do palete, ou inteiramente acima da carga.
        expect(topo <= basePalete + 1e-9 || base >= topoCarga - 1e-9).toBe(true);
      }
    }
  });

  it('o último nível ganha o travamento superior, no topo dos montantes', () => {
    const slots = [1, 2].map(n => vaga({ id: 'n' + n, nivel: n }));
    const [montante] = montantesDoArmazem(slots, cfg);
    const topoDosMontantes = montante.posicao[1] + montante.comprimento / 2;
    const maisAlta = Math.max(...vigasDoArmazem(slots, cfg).map(v => v.posicao[1] + ESTRUTURA.viga / 2));
    expect(maisAlta).toBeCloseTo(topoDosMontantes, 10);
  });

  it('é CORRIDA pela rua inteira, não um trecho por vaga', () => {
    const slots = [1, 2, 3, 4].map(m => vaga({ id: 'm' + m, modulo: m, nivel: 2 }));
    const [viga] = vigasDoArmazem(slots, cfg);
    expect(viga.comprimento).toBeCloseTo(4 * cfg.moduleWidth, 10);
  });

  it('acompanha a elevação da rua', () => {
    const elevado = { ...cfg, baseByStreet: { A: 2 } };
    const [viga] = vigasDoArmazem([vaga({ nivel: 1 })], elevado);
    expect(viga.posicao[1]).toBeCloseTo(2 + cfg.levelHeight - ESTRUTURA.viga / 2, 10);
  });

  it('cada rua recebe travessa conforme a PRÓPRIA altura', () => {
    // A de três níveis, C de um só — o caso real do armazém.
    const slots = [
      vaga({ id: 'a1', rua: 1, ruaCodigo: 'A', nivel: 1 }),
      vaga({ id: 'a3', rua: 1, ruaCodigo: 'A', nivel: 3 }),
      vaga({ id: 'c1', rua: 3, ruaCodigo: 'C', nivel: 1 }),
    ];
    const vigas = vigasDoArmazem(slots, cfg);
    const porRua = new Map<number, number>();
    for (const v of vigas) porRua.set(v.posicao[0], (porRua.get(v.posicao[0]) ?? 0) + 1);
    // Rua A: 3 níveis x 2 fileiras = 6 em cada X (frente e fundo somam 3 cada).
    // Rua C: 1 nível x 2 fileiras = 1 em cada X.
    expect([...porRua.values()].sort((a, b) => a - b)).toEqual([1, 1, 3, 3]);
  });

  it('armazém vazio não produz viga', () => {
    expect(vigasDoArmazem([], cfg)).toEqual([]);
  });
});
