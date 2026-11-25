// A regra de destaque, agora compartilhada pelas duas vistas.
//
// O que estes testes travam é a PRECEDÊNCIA e a soma dos critérios — era o que estava
// escrito dentro do `useMemo` da vista por código e não tinha como ser conferido sem
// montar a cena.

import { describe, expect, it } from 'vitest';
import { SEM_DESTAQUE, destaqueDaVaga, type ContextoDeDestaque } from '../warehouse3dDestaque';
import type { Slot, SlotStatus } from '../warehouse3dSlots';

const vaga = (id: string, ruaCodigo: string, status: SlotStatus = 'occupied'): Pick<Slot, 'id' | 'ruaCodigo' | 'status'> =>
  ({ id, ruaCodigo, status });

const ctx = (patch: Partial<ContextoDeDestaque> = {}): ContextoDeDestaque => ({
  ...SEM_DESTAQUE,
  ...patch,
});

describe('destaqueDaVaga', () => {
  it('sem filtro nenhum, toda vaga está ativa', () => {
    const d = destaqueDaVaga(vaga('PP-A01-N1', 'A'), SEM_DESTAQUE);
    expect(d).toEqual({ ativa: true, achada: false, pulsando: false });
  });

  it('conjunto VAZIO de ruas significa todas, não nenhuma', () => {
    // O sentinela é a ausência. Guardar "todas" como valor especial obrigaria cada
    // consumidor a conhecê-lo.
    expect(destaqueDaVaga(vaga('PP-A01-N1', 'A'), ctx({ ruasSelecionadas: new Set() })).ativa).toBe(true);
  });

  it('rua fora da seleção sai de destaque', () => {
    const c = ctx({ ruasSelecionadas: new Set(['E', 'F']) });
    expect(destaqueDaVaga(vaga('PP-E01-N1', 'E'), c).ativa).toBe(true);
    expect(destaqueDaVaga(vaga('PP-A01-N1', 'A'), c).ativa).toBe(false);
  });

  it('filtro de status recorta por status', () => {
    const c = ctx({ filtro: 'blocked' });
    expect(destaqueDaVaga(vaga('PP-A01-N1', 'A', 'blocked'), c).ativa).toBe(true);
    expect(destaqueDaVaga(vaga('PP-A02-N1', 'A', 'occupied'), c).ativa).toBe(false);
  });

  it('a busca SOMA com os demais filtros em vez de substituí-los', () => {
    // Buscar um SKU com o filtro em "Bloqueadas" mostra a interseção. Substituir faria a
    // busca ignorar o filtro que a pessoa acabou de aplicar.
    const c = ctx({ filtro: 'blocked', achados: new Set(['PP-A01-N1', 'PP-A02-N1']) });
    expect(destaqueDaVaga(vaga('PP-A01-N1', 'A', 'blocked'), c).ativa).toBe(true);
    expect(destaqueDaVaga(vaga('PP-A02-N1', 'A', 'occupied'), c).ativa).toBe(false);
  });

  it('achada continua marcada mesmo quando sai de destaque pelo filtro de rua', () => {
    // É o que permite a vista desenhar o achado como vidro/contorno em vez de sumir com
    // ele: a tela precisa saber as duas coisas ao mesmo tempo.
    const c = ctx({ ruasSelecionadas: new Set(['B']), achados: new Set(['PP-A01-N1']) });
    const d = destaqueDaVaga(vaga('PP-A01-N1', 'A'), c);
    expect(d.achada).toBe(true);
    expect(d.ativa).toBe(false);
  });

  it('busca sem resultado tira todo mundo de destaque', () => {
    // Conjunto vazio é diferente de `null`: um diz "procurei e não achei", o outro diz
    // "não há busca em curso".
    expect(destaqueDaVaga(vaga('PP-A01-N1', 'A'), ctx({ achados: new Set() })).ativa).toBe(false);
    expect(destaqueDaVaga(vaga('PP-A01-N1', 'A'), ctx({ achados: null })).ativa).toBe(true);
  });

  it('o pulso é independente do filtro: ele avisa, não seleciona', () => {
    const c = ctx({ ruasSelecionadas: new Set(['B']), pulsando: new Set(['PP-A01-N1']) });
    const d = destaqueDaVaga(vaga('PP-A01-N1', 'A'), c);
    expect(d.pulsando).toBe(true);
    expect(d.ativa).toBe(false);
  });

  it('os três critérios de ativa se somam', () => {
    const c = ctx({
      ruasSelecionadas: new Set(['A']),
      filtro: 'occupied',
      achados: new Set(['PP-A01-N1']),
    });
    expect(destaqueDaVaga(vaga('PP-A01-N1', 'A', 'occupied'), c).ativa).toBe(true);
    expect(destaqueDaVaga(vaga('PP-A01-N1', 'A', 'empty'), c).ativa).toBe(false);
    expect(destaqueDaVaga(vaga('PP-B01-N1', 'B', 'occupied'), c).ativa).toBe(false);
  });
});
