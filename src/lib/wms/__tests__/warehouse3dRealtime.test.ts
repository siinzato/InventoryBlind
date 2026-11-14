// Tradução de evento de tempo real em endereço de vaga.
//
// O que está em jogo: o destaque "outro operador mexeu aqui". As duas tabelas guardam
// o UUID da vaga em campos DIFERENTES, e trocar um pelo outro não gera erro nenhum —
// gera destaque na vaga errada, que é pior, porque parece funcionar.

import { describe, it, expect } from 'vitest';
import {
  TABELA_SALDO, TABELA_VAGAS, binIdDoEvento, codigoDaMudanca,
} from '../warehouse3dRealtime';

const UUID_A = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';

const mapa = new Map([
  [UUID_A, 'PP-A01-N1'],
  [UUID_B, 'PP-B03-N2'],
]);

describe('binIdDoEvento', () => {
  it('no SALDO, lê bin_id — a chave estrangeira, não a da própria linha', () => {
    // `id` aqui é da linha de saldo. Usá-lo apontaria para uma vaga inexistente.
    const novo = { id: 'linha-de-saldo', bin_id: UUID_A, boxes: 6 };
    expect(binIdDoEvento(TABELA_SALDO, novo, null)).toBe(UUID_A);
  });

  it('nas VAGAS, lê id — ali a linha é a própria vaga', () => {
    expect(binIdDoEvento(TABELA_VAGAS, { id: UUID_B, blocked: true }, null)).toBe(UUID_B);
  });

  it('o registro NOVO tem precedência sobre o antigo', () => {
    const encontrado = binIdDoEvento(TABELA_SALDO, { bin_id: UUID_A }, { bin_id: UUID_B });
    expect(encontrado).toBe(UUID_A);
  });

  it('em DELETE, cai para o registro antigo', () => {
    // Só funciona porque a migration 129 pôs `replica identity full` no saldo: com a
    // identidade padrão o antigo traria apenas a PK e o bin_id viria vazio.
    expect(binIdDoEvento(TABELA_SALDO, null, { bin_id: UUID_A })).toBe(UUID_A);
    expect(binIdDoEvento(TABELA_VAGAS, null, { id: UUID_B })).toBe(UUID_B);
  });

  it('DELETE sem o bin_id no antigo devolve null, não um palpite', () => {
    expect(binIdDoEvento(TABELA_SALDO, null, { id: 'so-a-pk' })).toBeNull();
  });

  it('tabela desconhecida devolve null', () => {
    expect(binIdDoEvento('outra_tabela', { id: UUID_A, bin_id: UUID_A }, null)).toBeNull();
  });

  it('campo vazio ou de outro tipo não vira identificador', () => {
    expect(binIdDoEvento(TABELA_SALDO, { bin_id: '' }, null)).toBeNull();
    expect(binIdDoEvento(TABELA_SALDO, { bin_id: 42 }, null)).toBeNull();
    expect(binIdDoEvento(TABELA_VAGAS, undefined, undefined)).toBeNull();
  });
});

describe('codigoDaMudanca', () => {
  it('traduz o UUID para o código impresso na etiqueta', () => {
    expect(codigoDaMudanca(TABELA_SALDO, { bin_id: UUID_A }, null, mapa)).toBe('PP-A01-N1');
    expect(codigoDaMudanca(TABELA_VAGAS, { id: UUID_B }, null, mapa)).toBe('PP-B03-N2');
  });

  it('vaga desconhecida devolve null em vez de chutar um código', () => {
    // Vaga criada por outro operador depois da última carga: a tela ainda recarrega,
    // só não tem o que destacar.
    const desconhecida = '99999999-9999-9999-9999-999999999999';
    expect(codigoDaMudanca(TABELA_SALDO, { bin_id: desconhecida }, null, mapa)).toBeNull();
  });

  it('evento sem identificador nenhum devolve null', () => {
    expect(codigoDaMudanca(TABELA_SALDO, {}, {}, mapa)).toBeNull();
  });

  it('mapa vazio nunca inventa correspondência', () => {
    expect(codigoDaMudanca(TABELA_SALDO, { bin_id: UUID_A }, null, new Map())).toBeNull();
  });
});
