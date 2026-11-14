// O traçado da rota de coleta, verificado sem WebGL.
//
// O que está em jogo: esta linha diz a um operador por onde andar. Uma rota que
// atravessa a estante não é um defeito visual — é uma instrução impossível de cumprir,
// e quem a recebe perde a confiança na tela inteira. A ordem das paradas é regra de
// negócio (FIFO), não preferência de desenho.

import { describe, it, expect } from 'vitest';
import {
  ALTURA_DA_ROTA, cabeceiraZ, caminhoNoPiso, paradasDaRota, subidasAteAVaga,
} from '../warehouse3dRota';
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

const acervo = [
  vaga({ id: 'A-m1-n1', rua: 1, modulo: 1, nivel: 1 }),
  vaga({ id: 'A-m5-n2', rua: 1, modulo: 5, nivel: 2 }),
  vaga({ id: 'B-m3-n1', rua: 2, ruaCodigo: 'B', modulo: 3, nivel: 1 }),
  vaga({ id: 'C-m2-n3', rua: 3, ruaCodigo: 'C', modulo: 2, nivel: 3 }),
];

describe('paradasDaRota', () => {
  it('PRESERVA a ordem recebida — ela é a regra FIFO, não uma preferência', () => {
    const paradas = paradasDaRota(['C-m2-n3', 'A-m1-n1', 'B-m3-n1'], acervo, cfg);
    expect(paradas.map(p => p.slot.id)).toEqual(['C-m2-n3', 'A-m1-n1', 'B-m3-n1']);
  });

  it('numera as paradas a partir de 1', () => {
    const paradas = paradasDaRota(['A-m1-n1', 'B-m3-n1'], acervo, cfg);
    expect(paradas.map(p => p.ordem)).toEqual([1, 2]);
  });

  it('não manda o operador duas vezes à mesma vaga', () => {
    // Vaga misturada aparece em duas linhas de saldo; é uma parada só.
    const paradas = paradasDaRota(['A-m1-n1', 'A-m1-n1', 'B-m3-n1'], acervo, cfg);
    expect(paradas.map(p => p.slot.id)).toEqual(['A-m1-n1', 'B-m3-n1']);
    expect(paradas[1].ordem).toBe(2);
  });

  it('descarta endereço desconhecido em vez de criar parada na origem', () => {
    const paradas = paradasDaRota(['NAO-EXISTE', 'A-m1-n1'], acervo, cfg);
    expect(paradas).toHaveLength(1);
    expect(paradas[0].slot.id).toBe('A-m1-n1');
    expect(paradas[0].ordem).toBe(1);
  });

  it('o pé da parada fica no piso e a vaga na altura real dela', () => {
    const [parada] = paradasDaRota(['C-m2-n3'], acervo, cfg);
    const [x, y, z] = posicaoDaVaga(acervo[3], cfg);
    expect(parada.noPiso).toEqual([x, ALTURA_DA_ROTA, z]);
    expect(parada.naVaga).toEqual([x, y, z]);
    expect(parada.naVaga[1]).toBeGreaterThan(parada.noPiso[1]);
  });

  it('lista vazia devolve nenhuma parada', () => {
    expect(paradasDaRota([], acervo, cfg)).toEqual([]);
  });
});

describe('caminhoNoPiso', () => {
  it('menos de duas paradas não produz linha', () => {
    expect(caminhoNoPiso(paradasDaRota(['A-m1-n1'], acervo, cfg), cfg)).toEqual([]);
    expect(caminhoNoPiso([], cfg)).toEqual([]);
  });

  it('dentro da MESMA rua vai direto, sem desvio pela cabeceira', () => {
    const paradas = paradasDaRota(['A-m1-n1', 'A-m5-n2'], acervo, cfg);
    const caminho = caminhoNoPiso(paradas, cfg);
    expect(caminho).toHaveLength(2);
    expect(caminho.every(p => p[0] === 0)).toBe(true);
  });

  it('para trocar de rua, passa pela CABECEIRA — nunca atravessa a estante', () => {
    const paradas = paradasDaRota(['A-m5-n2', 'B-m3-n1'], acervo, cfg);
    const caminho = caminhoNoPiso(paradas, cfg);
    const z0 = cabeceiraZ(cfg);

    // Todo segmento que muda de X tem de acontecer NA cabeceira.
    for (let i = 1; i < caminho.length; i += 1) {
      if (caminho[i][0] !== caminho[i - 1][0]) {
        expect(caminho[i][2]).toBe(z0);
        expect(caminho[i - 1][2]).toBe(z0);
      }
    }
  });

  it('a cabeceira fica ANTES do primeiro módulo, fora das estantes', () => {
    expect(cabeceiraZ(cfg)).toBeLessThan(0);
  });

  it('todo o traçado corre na altura do piso', () => {
    const paradas = paradasDaRota(['A-m5-n2', 'B-m3-n1', 'C-m2-n3'], acervo, cfg);
    const caminho = caminhoNoPiso(paradas, cfg);
    expect(caminho.every(p => p[1] === ALTURA_DA_ROTA)).toBe(true);
  });

  it('cada segmento anda em UM eixo só — nunca na diagonal por cima das vagas', () => {
    const paradas = paradasDaRota(['A-m5-n2', 'B-m3-n1', 'C-m2-n3'], acervo, cfg);
    const caminho = caminhoNoPiso(paradas, cfg);
    expect(caminho.length).toBeGreaterThan(2);
    for (let i = 1; i < caminho.length; i += 1) {
      const mudouX = caminho[i][0] !== caminho[i - 1][0];
      const mudouZ = caminho[i][2] !== caminho[i - 1][2];
      expect(mudouX && mudouZ).toBe(false);
    }
  });

  it('o traçado começa na primeira parada — não há doca para partir', () => {
    const paradas = paradasDaRota(['A-m5-n2', 'B-m3-n1'], acervo, cfg);
    expect(caminhoNoPiso(paradas, cfg)[0]).toEqual(paradas[0].noPiso);
  });

  it('o traçado termina na última parada — não há picking para entregar', () => {
    const paradas = paradasDaRota(['A-m5-n2', 'B-m3-n1'], acervo, cfg);
    const caminho = caminhoNoPiso(paradas, cfg);
    expect(caminho[caminho.length - 1]).toEqual(paradas[1].noPiso);
  });
});

describe('subidasAteAVaga', () => {
  it('vaga da face de piso NÃO ganha subida', () => {
    // Medido no armazém real: no nível 1 o pé da vaga fica em y=0, ABAIXO do traçado
    // (0,2). Desenhar o segmento produzia um toco apontando para baixo, furando o chão.
    const paradas = paradasDaRota(['A-m1-n1'], acervo, cfg);
    expect(paradas[0].naVaga[1] - VAGA.altura / 2).toBeLessThanOrEqual(ALTURA_DA_ROTA);
    expect(subidasAteAVaga(paradas)).toEqual([]);
  });

  it('nenhuma subida aponta para baixo', () => {
    const paradas = paradasDaRota(['A-m1-n1', 'A-m5-n2', 'B-m3-n1', 'C-m2-n3'], acervo, cfg);
    for (const s of subidasAteAVaga(paradas)) {
      expect(s.ate[1]).toBeGreaterThan(s.de[1]);
    }
  });

  it('só os níveis elevados produzem subida', () => {
    const paradas = paradasDaRota(['A-m1-n1', 'A-m5-n2', 'C-m2-n3'], acervo, cfg);
    expect(subidasAteAVaga(paradas).map(s => s.id)).toEqual(['A-m5-n2', 'C-m2-n3']);
  });

  it('carrega o código da vaga, para não depender do índice da parada', () => {
    // A lista é filtrada; casar por posição com `paradas` daria a subida errada.
    const paradas = paradasDaRota(['A-m1-n1', 'C-m2-n3'], acervo, cfg);
    const subidas = subidasAteAVaga(paradas);
    expect(subidas).toHaveLength(1);
    expect(subidas[0].id).toBe('C-m2-n3');
  });

  it('sobe do piso até o PÉ da vaga, sem entrar por dentro dela', () => {
    const paradas = paradasDaRota(['C-m2-n3'], acervo, cfg);
    const [subida] = subidasAteAVaga(paradas);
    expect(subida.de[1]).toBe(ALTURA_DA_ROTA);
    expect(subida.ate[1]).toBe(paradas[0].naVaga[1] - VAGA.altura / 2);
    expect(subida.ate[1]).toBeLessThan(paradas[0].naVaga[1]);
  });

  it('a subida fica na vertical: mesmo X e Z do pé', () => {
    const paradas = paradasDaRota(['C-m2-n3'], acervo, cfg);
    const [subida] = subidasAteAVaga(paradas);
    expect(subida.de[0]).toBe(subida.ate[0]);
    expect(subida.de[2]).toBe(subida.ate[2]);
  });

  it('nível 3 sobe mais alto que nível 2', () => {
    const paradas = paradasDaRota(['A-m5-n2', 'C-m2-n3'], acervo, cfg);
    const [media, alta] = subidasAteAVaga(paradas);
    expect(alta.ate[1]).toBeGreaterThan(media.ate[1]);
  });
});
