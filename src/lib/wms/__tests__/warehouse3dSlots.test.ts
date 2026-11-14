// A regra de cor da cena 3D, verificada sem WebGL.
//
// O que está em jogo: cada status vira uma COR no mapa do armazém, e o operador age
// sobre a cor. Uma vaga bloqueada pintada de livre manda um pallet para uma vaga
// interditada. Por isso a regra mora fora do `<Canvas>` e é conferida aqui.

import { describe, it, expect } from 'vitest';
import { buildSlots, statusDaVaga } from '../warehouse3dSlots';
import type { StorageBin } from '../wmsService';

const vaga = (over: Partial<StorageBin> = {}): StorageBin => ({
  id: 'id-' + (over.code ?? 'x'),
  code: 'PP-A01-N1',
  binType: 'pulmao',
  capacityBoxes: null,
  blocked: false,
  blockedReason: null,
  ...over,
});

describe('statusDaVaga', () => {
  it('bloqueio vence saldo — vaga interditada com caixas dentro continua bloqueada', () => {
    expect(statusDaVaga({ blocked: true, capacityBoxes: 10 }, 5)).toBe('blocked');
    expect(statusDaVaga({ blocked: true, capacityBoxes: null }, 0)).toBe('blocked');
  });

  it('sem caixas é livre', () => {
    expect(statusDaVaga({ blocked: false, capacityBoxes: 10 }, 0)).toBe('empty');
  });

  it('com caixas dentro da capacidade é ocupada', () => {
    expect(statusDaVaga({ blocked: false, capacityBoxes: 10 }, 7)).toBe('occupied');
  });

  it('ocupar a capacidade INTEIRA é vaga cheia, não alerta', () => {
    // Estritamente maior. Se fosse >=, toda vaga cheia viraria alerta e o alerta
    // deixaria de significar alguma coisa.
    expect(statusDaVaga({ blocked: false, capacityBoxes: 10 }, 10)).toBe('occupied');
    expect(statusDaVaga({ blocked: false, capacityBoxes: 10 }, 11)).toBe('divergence');
  });

  it('sem capacidade cadastrada nunca gera alerta — não há contra o que comparar', () => {
    // Hoje NENHUMA das 71 vagas tem capacidade preenchida, então na prática este é o
    // caminho que todo o armazém percorre. Se um dia um alerta aparecer sem ninguém
    // ter cadastrado capacidade, a regressão está aqui.
    expect(statusDaVaga({ blocked: false, capacityBoxes: null }, 999)).toBe('occupied');
  });
});

describe('buildSlots', () => {
  it('converte a LETRA da rua em índice sobre o conjunto inteiro, não por vaga', () => {
    // A rua B não tem vaga no nível 1. Mesmo assim ela precisa ficar entre A e C —
    // se o índice fosse calculado por vaga, a C ocuparia o lugar da B no espaço.
    const { slots } = buildSlots(
      [vaga({ code: 'PP-A01-N1' }), vaga({ code: 'PP-B01-N2' }), vaga({ code: 'PP-C01-N1' })],
      new Map(),
    );
    expect(slots.map(s => [s.ruaCodigo, s.rua])).toEqual([
      ['A', 1],
      ['B', 2],
      ['C', 3],
    ]);
  });

  it('o índice não depende da ordem de entrada', () => {
    const { slots } = buildSlots(
      [vaga({ code: 'PP-C01-N1' }), vaga({ code: 'PP-A01-N1' })],
      new Map(),
    );
    const porLetra = new Map(slots.map(s => [s.ruaCodigo, s.rua]));
    expect(porLetra.get('A')).toBe(1);
    expect(porLetra.get('C')).toBe(2);
  });

  it('código fora do padrão não some: vai para naoPosicionaveis', () => {
    // Descartar em silêncio faria o 3D mostrar menos armazém do que existe — o tipo
    // de erro que ninguém reporta porque a tela parece inteira.
    const { slots, naoPosicionaveis } = buildSlots(
      [vaga({ code: 'PP-A01-N1' }), vaga({ code: 'AVULSA' }), vaga({ code: 'bagunca' })],
      new Map(),
    );
    expect(slots).toHaveLength(1);
    expect(naoPosicionaveis).toEqual(['AVULSA', 'bagunca']);
  });

  it('o saldo vem do mapa por código, e vaga ausente do mapa é zero', () => {
    const { slots } = buildSlots(
      [vaga({ code: 'PP-A01-N1' }), vaga({ code: 'PP-A02-N1' })],
      new Map([['PP-A01-N1', 4]]),
    );
    expect(slots.map(s => [s.id, s.caixas, s.status])).toEqual([
      ['PP-A01-N1', 4, 'occupied'],
      ['PP-A02-N1', 0, 'empty'],
    ]);
  });

  it('módulo e nível saem do código como número', () => {
    const { slots } = buildSlots([vaga({ code: 'PP-A07-N3' })], new Map());
    expect(slots[0]).toMatchObject({ ruaCodigo: 'A', modulo: 7, nivel: 3 });
  });

  it('armazém vazio devolve listas vazias, não quebra', () => {
    expect(buildSlots([], new Map())).toEqual({
      slots: [],
      naoPosicionaveis: [],
      codigoPorBinId: new Map(),
    });
  });

  it('mapeia UUID -> código de TODAS as vagas, inclusive as não posicionáveis', () => {
    // O evento de tempo real chega com o UUID. Deixar de fora a vaga fora do padrão
    // faria uma mudança nela parecer vaga desconhecida.
    const { codigoPorBinId } = buildSlots(
      [vaga({ code: 'PP-A01-N1' }), vaga({ code: 'FORA-DO-PADRAO' })],
      new Map(),
    );
    expect(codigoPorBinId.get('id-PP-A01-N1')).toBe('PP-A01-N1');
    expect(codigoPorBinId.get('id-FORA-DO-PADRAO')).toBe('FORA-DO-PADRAO');
  });
});
