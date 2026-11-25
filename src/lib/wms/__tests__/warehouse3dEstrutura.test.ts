// Geometria da estante, verificada sem WebGL.
//
// O que está em jogo: carga flutuando acima do palete, palete atravessando a viga, ou
// montante no meio do vão em vez da divisa. Nada disso lança erro — produz uma estante
// que parece certa de longe e está errada de perto, e é a única coisa que o operador
// usa para entender em que altura a mercadoria está.

import { describe, it, expect } from 'vitest';
import {
  CARGA, ESTRUTURA, PALETE, SAPATA,
  diagonaisDoArmazem, montantesDoArmazem, pisoDoVao, posicaoDaCarga, posicaoDoPalete,
  sapatasDosMontantes, vigasDoArmazem,
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

describe('diagonaisDoArmazem', () => {
  it('uma por nível em cada divisa — as MESMAS divisas dos montantes', () => {
    const slots = [1, 2, 3].map(m => vaga({ id: 'm' + m, modulo: m }));
    const diagonais = diagonaisDoArmazem(slots, cfg);
    const montantes = montantesDoArmazem(slots, cfg);
    const zDiagonais = [...new Set(diagonais.map(d => d.centro[2]))].sort((a, b) => a - b);
    const zMontantes = [...new Set(montantes.map(p => p.posicao[2]))].sort((a, b) => a - b);
    // Solta das colunas, a treliça viraria um risco flutuando entre dois vãos.
    expect(zDiagonais).toEqual(zMontantes);
    expect(diagonais).toHaveLength(4); // 4 divisas x 1 nível
  });

  it('cruza a PROFUNDIDADE, no eixo dos dois montantes que trava', () => {
    const [d] = diagonaisDoArmazem([vaga()], cfg);
    // Centrada entre as duas fileiras de montante, não numa delas.
    expect(d.centro[0]).toBeCloseTo(0, 10);
    // Comprimento igual à hipotenusa do vão livre com a subida de um nível.
    const vao = VAGA.profundidade - ESTRUTURA.montante;
    expect(d.tamanho[0]).toBeCloseTo(
      Math.hypot(vao, cfg.levelHeight - ESTRUTURA.diagonal),
      10,
    );
    expect(d.tamanho[1]).toBe(ESTRUTURA.diagonal);
    expect(d.tamanho[2]).toBe(ESTRUTURA.diagonal);
  });

  it('NÃO fura o topo da estante — a seção inclinada ocupa Y além da subida', () => {
    // O erro que já aconteceu na planta física: com a subida cheia, a peça do último
    // nível passava do topo. Aqui a conta é feita como o desenho faz, com o giro.
    const slots = [1, 2, 3].map(n => vaga({ id: 'n' + n, nivel: n }));
    const topoDaEstante = 3 * cfg.levelHeight;
    for (const d of diagonaisDoArmazem(slots, cfg)) {
      const [comprimento, secao] = d.tamanho;
      const extensaoY =
        Math.abs(comprimento * Math.sin(d.rotacaoZ)) + Math.abs(secao * Math.cos(d.rotacaoZ));
      expect(d.centro[1] + extensaoY / 2).toBeLessThanOrEqual(topoDaEstante + 1e-9);
      expect(d.centro[1] - extensaoY / 2).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('a extensão vertical cabe no nível, com a folga da própria seção', () => {
    // Não fecha EXATAMENTE em um nível, e a conta diz por quê: a extensão é
    // `subida + seção·cos θ`, e a subida já desconta a seção inteira. Sobra
    // `seção·(1 − cos θ)` — 1,9 cm no layout padrão. A folga é de propósito: descontar
    // a seção cheia é a forma conservadora, e é ela que garante a peça nunca furar o
    // topo, qualquer que seja o ângulo.
    const [d] = diagonaisDoArmazem([vaga()], cfg);
    const [comprimento, secao] = d.tamanho;
    const extensaoY =
      Math.abs(comprimento * Math.sin(d.rotacaoZ)) + Math.abs(secao * Math.cos(d.rotacaoZ));
    const folga = secao * (1 - Math.cos(Math.abs(d.rotacaoZ)));
    expect(extensaoY).toBeCloseTo(cfg.levelHeight - folga, 10);
    expect(folga).toBeLessThan(secao);
  });

  it('alterna o sentido — zigue-zague, não um feixe de riscos paralelos', () => {
    const slots = [1, 2].map(m => vaga({ id: 'm' + m, modulo: m }));
    const sentidos = new Set(diagonaisDoArmazem(slots, cfg).map(d => Math.sign(d.rotacaoZ)));
    expect([...sentidos].sort()).toEqual([-1, 1]);
  });

  it('rua elevada leva a treliça junto', () => {
    const elevado = { ...cfg, baseByStreet: { A: 2.5 } };
    const [d] = diagonaisDoArmazem([vaga()], elevado);
    expect(d.centro[1]).toBeCloseTo(2.5 + cfg.levelHeight / 2, 10);
  });

  it('cada rua tem a própria contagem — uma rua baixa não ganha nível da alta', () => {
    const slots = [
      vaga({ id: 'a', rua: 1, ruaCodigo: 'A', nivel: 1 }),
      vaga({ id: 'b', rua: 2, ruaCodigo: 'B', nivel: 3 }),
    ];
    const porRua = new Map<number, number>();
    for (const d of diagonaisDoArmazem(slots, cfg)) {
      porRua.set(d.centro[0], (porRua.get(d.centro[0]) ?? 0) + 1);
    }
    // 2 divisas x 1 nível na rua A, 2 divisas x 3 níveis na rua B.
    expect([...porRua.values()].sort((a, b) => a - b)).toEqual([2, 6]);
  });

  it('armazém vazio não produz diagonal', () => {
    expect(diagonaisDoArmazem([], cfg)).toEqual([]);
  });

  it('nível mais baixo que a própria seção não produz peça torta', () => {
    // Guarda de borda: com `levelHeight` degenerado a hipotenusa inverteria o sinal da
    // subida e a diagonal desceria em vez de subir.
    expect(diagonaisDoArmazem([vaga()], { ...cfg, levelHeight: ESTRUTURA.diagonal })).toEqual([]);
  });
});

describe('sapatasDosMontantes - a chapa de base na vista por codigo', () => {
  const slots = [1, 2, 3].map(m => vaga({ id: 'm' + m, modulo: m, nivel: 3 }));

  it('uma sapata por montante', () => {
    const montantes = montantesDoArmazem(slots, cfg);
    expect(montantes.length).toBeGreaterThan(0);
    expect(sapatasDosMontantes(montantes)).toHaveLength(montantes.length);
  });

  it('cada sapata nasce no PE do seu montante, apoiada no piso da rua', () => {
    const montantes = montantesDoArmazem(slots, cfg);
    const sapatas = sapatasDosMontantes(montantes);
    montantes.forEach((m, i) => {
      expect(sapatas[i].centro[0]).toBeCloseTo(m.posicao[0], 9);
      expect(sapatas[i].centro[2]).toBeCloseTo(m.posicao[2], 9);
      const peDoMontante = m.posicao[1] - m.comprimento / 2;
      expect(sapatas[i].centro[1] - sapatas[i].tamanho[1] / 2).toBeCloseTo(peDoMontante, 9);
    });
  });

  it('acompanha a rua SUSPENSA: sapata no ar e sapata que nao sustenta nada', () => {
    // Numa rua elevada o montante comeca acima do piso, e a chapa de base vai junto com
    // ele. Fixar a sapata em Y=0 poria a chapa no chao com a coluna flutuando tres
    // metros acima dela.
    const suspenso = { ...cfg, baseByStreet: { A: 3 } };
    const montantes = montantesDoArmazem(slots, suspenso);
    for (const s of sapatasDosMontantes(montantes)) {
      expect(s.centro[1]).toBeGreaterThan(3);
    }
  });

  it('a sapata e mais larga que o montante nos dois eixos do piso', () => {
    const s = sapatasDosMontantes(montantesDoArmazem(slots, cfg))[0];
    expect(s.tamanho[0]).toBeGreaterThan(ESTRUTURA.montante);
    expect(s.tamanho[2]).toBeGreaterThan(ESTRUTURA.montante);
    expect(s.tamanho[0]).toBe(SAPATA.lado);
  });

  it('a chapa e FINA: nao levanta a estante nem rouba altura do nivel 1', () => {
    const s = sapatasDosMontantes(montantesDoArmazem(slots, cfg))[0];
    expect(s.tamanho[1]).toBeLessThan(ESTRUTURA.palete);
  });
});
