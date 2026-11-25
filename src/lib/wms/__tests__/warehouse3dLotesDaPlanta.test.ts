// Os sete lotes da planta.
//
// O que está em jogo: a instância perde a opacidade por item (alpha não cabe em
// `instanceColor`), então o LOTE passa a ser o que carrega o estado visual. Cair no lote
// errado não dá erro — dá uma vaga fora do filtro desenhada como se estivesse em
// destaque, ou um vão sem endereço parecendo endereço disponível.

import { describe, expect, it } from 'vitest';
import { lotesDaPlanta, totalDeInstancias, type PaletaDosLotes } from '../warehouse3dLotesDaPlanta';
import { SEM_DESTAQUE, type ContextoDeDestaque } from '../warehouse3dDestaque';
import { blocosDaPlanta, vaosDaFileira } from '../warehouse3dPlantaFisica';
import type { Slot } from '../warehouse3dSlots';

const PALETA: PaletaDosLotes = {
  pulso: '#PULSO',
  busca: '#BUSCA',
  atenuada: '#ATENUADA',
  fantasma: '#FANTASMA',
};

const MEDIDAS = { alturaDoPalete: 0.12, alturaDoPiso: 0.08 };

const COR_DO_MODO = '#MODO';
const corDaVaga = () => COR_DO_MODO;

const blocos = blocosDaPlanta();
const fileiras = blocos.filter(b => b.tipo === 'fileira');

/** TODOS os vãos desenhados, com código ou sem. */
const todosOsVaos = fileiras.flatMap(b => vaosDaFileira(b));

/**
 * Só os que têm código.
 *
 * A diferença entre os dois não é detalhe: a planta tem uma fileira SEM rua cadastrada
 * (a quinta do prédio atual, que a lista de rótulos A–D não alcança), e os vãos dela
 * nascem sem código. Eles existem no desenho e nunca viram endereço.
 */
const codigos = todosOsVaos.map(v => v.codigo).filter((c): c is string => !!c);

const vaga = (id: string, caixas: number, over: Partial<Slot> = {}): Slot => ({
  id,
  rua: 1,
  ruaCodigo: /^PP-([A-Z]+)/.exec(id)?.[1] ?? 'A',
  modulo: 1,
  nivel: 1,
  status: caixas > 0 ? 'occupied' : 'empty',
  caixas,
  capacidade: null,
  ...over,
});

const mapa = (...vagas: Slot[]) => new Map(vagas.map(v => [v.id, v]));

const montar = (vagas: Map<string, Slot>, destaque: ContextoDeDestaque = SEM_DESTAQUE) =>
  lotesDaPlanta(blocos, vagas, destaque, PALETA, corDaVaga, MEDIDAS);

describe('lotesDaPlanta — em que lote cada vão cai', () => {
  it('sem vaga cadastrada nenhuma, TODO vão vira piso fantasma', () => {
    const lotes = montar(new Map());
    expect(lotes.pisoFantasma).toHaveLength(todosOsVaos.length);
    expect(totalDeInstancias(lotes)).toBe(todosOsVaos.length);
    expect(lotes.pisoDestaque).toHaveLength(0);
    expect(lotes.cargaDestaque).toHaveLength(0);
  });

  it('o fantasma é INERTE: não carrega código para clicar', () => {
    const lotes = montar(new Map());
    expect(lotes.pisoFantasma.every(i => i.codigo === null)).toBe(true);
  });

  it('vaga livre vira piso em destaque, com a cor do modo', () => {
    const lotes = montar(mapa(vaga(codigos[0], 0)));
    expect(lotes.pisoDestaque).toHaveLength(1);
    expect(lotes.pisoDestaque[0].codigo).toBe(codigos[0]);
    expect(lotes.pisoDestaque[0].cor).toBe(COR_DO_MODO);
    expect(lotes.pisoFantasma).toHaveLength(todosOsVaos.length - 1);
  });

  it('vaga com carga vira palete + carga, e NÃO desenha piso', () => {
    // O palete cobre o piso; desenhar os dois seria geometria escondida custando quadro.
    const lotes = montar(mapa(vaga(codigos[0], 7)));
    expect(lotes.paleteDestaque).toHaveLength(1);
    expect(lotes.cargaDestaque).toHaveLength(1);
    expect(lotes.pisoDestaque).toHaveLength(0);
    expect(lotes.pisoFantasma).toHaveLength(todosOsVaos.length - 1);
  });

  it('fora do filtro, a vaga muda de LOTE — é o lote que carrega a opacidade', () => {
    const codigoA = codigos.find(c => c.startsWith('PP-A'))!;
    const destaque: ContextoDeDestaque = { ...SEM_DESTAQUE, ruasSelecionadas: new Set(['E']) };
    const lotes = montar(mapa(vaga(codigoA, 0)), destaque);
    expect(lotes.pisoAtenuado).toHaveLength(1);
    expect(lotes.pisoDestaque).toHaveLength(0);
    expect(lotes.pisoAtenuado[0].cor).toBe(PALETA.atenuada);
  });

  it('carga fora do filtro vai para os lotes atenuados, palete junto', () => {
    const codigoA = codigos.find(c => c.startsWith('PP-A'))!;
    const destaque: ContextoDeDestaque = { ...SEM_DESTAQUE, ruasSelecionadas: new Set(['E']) };
    const lotes = montar(mapa(vaga(codigoA, 3)), destaque);
    expect(lotes.cargaAtenuada).toHaveLength(1);
    expect(lotes.paleteAtenuado).toHaveLength(1);
    expect(lotes.cargaDestaque).toHaveLength(0);
    expect(lotes.paleteDestaque).toHaveLength(0);
  });
});

describe('lotesDaPlanta — precedência da cor', () => {
  const codigo = () => codigos[0];

  it('pulso vence tudo', () => {
    const lotes = montar(
      mapa(vaga(codigo(), 0)),
      { ...SEM_DESTAQUE, pulsando: new Set([codigo()]), achados: new Set([codigo()]) },
    );
    expect(lotes.pisoDestaque[0].cor).toBe(PALETA.pulso);
  });

  it('busca vence o modo de cor', () => {
    const lotes = montar(mapa(vaga(codigo(), 0)), { ...SEM_DESTAQUE, achados: new Set([codigo()]) });
    expect(lotes.pisoDestaque[0].cor).toBe(PALETA.busca);
  });

  it('achada fora do filtro de rua: cor de busca, mas lote ATENUADO', () => {
    // As duas informações convivem — é o que a vista por código sempre fez.
    const alvo = codigos.find(c => c.startsWith('PP-A'))!;
    const lotes = montar(
      mapa(vaga(alvo, 0)),
      { ...SEM_DESTAQUE, ruasSelecionadas: new Set(['E']), achados: new Set([alvo]) },
    );
    expect(lotes.pisoAtenuado).toHaveLength(1);
    expect(lotes.pisoAtenuado[0].cor).toBe(PALETA.busca);
  });

  it('o pulso aparece mesmo com a vaga fora do filtro', () => {
    const alvo = codigos.find(c => c.startsWith('PP-A'))!;
    const lotes = montar(
      mapa(vaga(alvo, 0)),
      { ...SEM_DESTAQUE, ruasSelecionadas: new Set(['E']), pulsando: new Set([alvo]) },
    );
    expect(lotes.pisoAtenuado[0].cor).toBe(PALETA.pulso);
  });
});

describe('lotesDaPlanta — geometria por instância', () => {
  it('a ESCALA vai por instância: fileiras com passos diferentes produzem larguras diferentes', () => {
    // É o motivo de a geometria ser um cubo unitário escalado, e não uma caixa fixa.
    const todas = new Map(codigos.map(c => [c, vaga(c, 0)]));
    const lotes = montar(todas);
    const comprimentos = new Set(lotes.pisoDestaque.map(i => i.tamanho[2].toFixed(4)));
    expect(comprimentos.size).toBeGreaterThan(1);
  });

  it('o palete apoia no piso do vão e a carga fica SOBRE ele, sem atravessar', () => {
    const lotes = montar(mapa(vaga(codigos[0], 5)));
    const palete = lotes.paleteDestaque[0];
    const carga = lotes.cargaDestaque[0];
    const topoDoPalete = palete.centro[1] + palete.tamanho[1] / 2;
    const baseDaCarga = carga.centro[1] - carga.tamanho[1] / 2;
    expect(baseDaCarga).toBeCloseTo(topoDoPalete, 6);
  });

  it('a carga é mais estreita que o vão, e cabe na altura restante', () => {
    const lotes = montar(mapa(vaga(codigos[0], 5)));
    const palete = lotes.paleteDestaque[0];
    const carga = lotes.cargaDestaque[0];
    expect(carga.tamanho[0]).toBeLessThan(palete.tamanho[0]);
    const topoDaCarga = carga.centro[1] + carga.tamanho[1] / 2;
    const vaoDeOrigem = fileiras
      .flatMap(b => vaosDaFileira(b))
      .find(v => v.codigo === codigos[0])!;
    expect(topoDaCarga).toBeLessThanOrEqual(vaoDeOrigem.centro[1] + vaoDeOrigem.tamanho[1] / 2 + 1e-9);
  });

  it('o piso da vaga livre assenta no fundo do vão', () => {
    const lotes = montar(mapa(vaga(codigos[0], 0)));
    const piso = lotes.pisoDestaque[0];
    const vaoDeOrigem = fileiras
      .flatMap(b => vaosDaFileira(b))
      .find(v => v.codigo === codigos[0])!;
    const baseDoVao = vaoDeOrigem.centro[1] - vaoDeOrigem.tamanho[1] / 2;
    expect(piso.centro[1] - piso.tamanho[1] / 2).toBeCloseTo(baseDoVao, 6);
  });
});

describe('lotesDaPlanta — conservação', () => {
  it('nenhum vão some e nenhum é contado duas vezes', () => {
    // Com carga, um vão vira DUAS instâncias (palete e carga) — então o total é o número
    // de vãos mais o número de vãos com carga.
    const comCarga = [codigos[0], codigos[1]];
    const todas = new Map(codigos.map(c => [c, vaga(c, comCarga.includes(c) ? 4 : 0)]));
    const lotes = montar(todas);
    expect(totalDeInstancias(lotes)).toBe(todosOsVaos.length + comCarga.length);
  });

  it('a expedição e as mesas não viram vão', () => {
    const naoFileiras = blocos.filter(b => b.tipo !== 'fileira');
    expect(naoFileiras.length).toBeGreaterThan(0);
    expect(totalDeInstancias(lotesDaPlanta(naoFileiras, new Map(), SEM_DESTAQUE, PALETA, corDaVaga, MEDIDAS))).toBe(0);
  });
});
