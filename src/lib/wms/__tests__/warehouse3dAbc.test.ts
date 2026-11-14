// A regra que decide a COR de curva de cada endereço, verificada sem WebGL.
//
// O que está em jogo: a cor diz ao operador "este item gira muito, não deveria estar
// aqui em cima". Pintar um endereço misturado pela classe errada manda remanejar o
// pallet errado — e remanejamento no porta-pallet custa ciclo de empilhadeira.

import { describe, it, expect } from 'vitest';
import { abcPorVaga, alertasDeGiro, NIVEL_DE_PISO, type AbcClasse } from '../warehouse3dAbc';
import type { Slot } from '../warehouse3dSlots';

const saldo = (entradas: Record<string, { sku: string; boxes: number }[]>) =>
  new Map(Object.entries(entradas));

const classes = (entradas: Record<string, AbcClasse>) =>
  new Map(Object.entries(entradas)) as Map<string, AbcClasse>;

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

describe('abcPorVaga', () => {
  it('colore a vaga com a classe do único SKU que ela guarda', () => {
    const { porVaga } = abcPorVaga(
      saldo({ 'PP-A01-N1': [{ sku: 'SKU-1', boxes: 6 }] }),
      classes({ 'SKU-1': 'B' }),
    );
    expect(porVaga.get('PP-A01-N1')?.classe).toBe('B');
  });

  it('em endereço misturado, a classe MAIS ALTA vence', () => {
    // O caso real de PP-A01-N1 em produção: dois SKUs na mesma vaga.
    const { porVaga } = abcPorVaga(
      saldo({ 'PP-A01-N1': [{ sku: 'PARADO', boxes: 12 }, { sku: 'GIRA', boxes: 6 }] }),
      classes({ PARADO: 'C', GIRA: 'A' }),
    );
    expect(porVaga.get('PP-A01-N1')?.classe).toBe('A');
  });

  it('a ordem das linhas não muda a classe escolhida', () => {
    const invertido = abcPorVaga(
      saldo({ 'PP-A01-N1': [{ sku: 'GIRA', boxes: 6 }, { sku: 'PARADO', boxes: 12 }] }),
      classes({ PARADO: 'C', GIRA: 'A' }),
    );
    expect(invertido.porVaga.get('PP-A01-N1')?.classe).toBe('A');
  });

  it('B vence C, e A vence B', () => {
    const { porVaga } = abcPorVaga(
      saldo({
        BC: [{ sku: 'b', boxes: 1 }, { sku: 'c', boxes: 1 }],
        AB: [{ sku: 'a', boxes: 1 }, { sku: 'b', boxes: 1 }],
      }),
      classes({ a: 'A', b: 'B', c: 'C' }),
    );
    expect(porVaga.get('BC')?.classe).toBe('B');
    expect(porVaga.get('AB')?.classe).toBe('A');
  });

  it('SKU fora da análise NÃO vira C — a vaga fica sem cor de curva', () => {
    const { porVaga, semClasse } = abcPorVaga(
      saldo({ 'PP-A02-N2': [{ sku: 'NUNCA-VENDIDO', boxes: 3 }] }),
      classes({ OUTRO: 'A' }),
    );
    expect(porVaga.has('PP-A02-N2')).toBe(false);
    expect(semClasse).toBe(1);
  });

  it('mantém na lista de itens o SKU sem classe, para a tela de detalhe', () => {
    const { porVaga } = abcPorVaga(
      saldo({ 'PP-A01-N1': [{ sku: 'GIRA', boxes: 6 }, { sku: 'DESCONHECIDO', boxes: 12 }] }),
      classes({ GIRA: 'A' }),
    );
    const itens = porVaga.get('PP-A01-N1')?.itens ?? [];
    expect(itens).toHaveLength(2);
    expect(itens.find(i => i.sku === 'DESCONHECIDO')?.classe).toBeNull();
    expect(itens.find(i => i.sku === 'DESCONHECIDO')?.caixas).toBe(12);
  });

  it('conta um sem-classe por LINHA de saldo, não por vaga', () => {
    const { semClasse } = abcPorVaga(
      saldo({
        V1: [{ sku: 'x', boxes: 1 }, { sku: 'y', boxes: 1 }],
        V2: [{ sku: 'z', boxes: 1 }],
      }),
      classes({}),
    );
    expect(semClasse).toBe(3);
  });

  it('sem análise nenhuma, nenhuma vaga é colorida', () => {
    const { porVaga } = abcPorVaga(saldo({ V1: [{ sku: 'x', boxes: 1 }] }), classes({}));
    expect(porVaga.size).toBe(0);
  });

  it('armazém sem saldo devolve mapa vazio, não erro', () => {
    const { porVaga, semClasse } = abcPorVaga(saldo({}), classes({ a: 'A' }));
    expect(porVaga.size).toBe(0);
    expect(semClasse).toBe(0);
  });
});

describe('alertasDeGiro', () => {
  const porVaga = abcPorVaga(
    saldo({
      'PP-A01-N1': [{ sku: 'gira', boxes: 6 }],
      'PP-A01-N2': [{ sku: 'gira', boxes: 24 }],
      'PP-A13-N3': [{ sku: 'medio', boxes: 16 }],
    }),
    classes({ gira: 'A', medio: 'B' }),
  ).porVaga;

  it('não acusa classe A na face de piso', () => {
    const alertas = alertasDeGiro([vaga({ id: 'PP-A01-N1', nivel: 1 })], porVaga);
    expect(alertas).toHaveLength(0);
  });

  it('acusa classe A a partir do primeiro nível elevado', () => {
    const alertas = alertasDeGiro([vaga({ id: 'PP-A01-N2', nivel: 2 })], porVaga);
    expect(alertas.map(s => s.id)).toEqual(['PP-A01-N2']);
  });

  it('não acusa classe B, por mais alta que esteja', () => {
    const alertas = alertasDeGiro([vaga({ id: 'PP-A13-N3', nivel: 3 })], porVaga);
    expect(alertas).toHaveLength(0);
  });

  it('ignora vaga sem classe de curva', () => {
    const alertas = alertasDeGiro([vaga({ id: 'PP-Z99-N3', nivel: 3 })], porVaga);
    expect(alertas).toHaveLength(0);
  });

  it('a face de piso é o nível 1', () => {
    // Se esta constante mudar, o alerta passa a acusar (ou deixar de acusar) um andar
    // inteiro do armazém. É regra de operação, não detalhe de implementação.
    expect(NIVEL_DE_PISO).toBe(1);
  });
});
