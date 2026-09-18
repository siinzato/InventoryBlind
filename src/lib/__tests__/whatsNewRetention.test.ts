// Retenção do painel "O que há de novo?".
//
// O painel passou a ser um histórico RECENTE: montava 95 blocos de uma vez e travava.
// O corte acontece na origem (listRecentWhatsNew), não na renderização — estes testes
// travam as três propriedades que importam: teto, idade e ordem.

import { describe, expect, it } from 'vitest';
import {
  WHATS_NEW_ENTRIES, WHATS_NEW_MAX_ENTRIES, WHATS_NEW_MAX_AGE_DAYS, listRecentWhatsNew,
} from '../whatsNew';

const DAY_MS = 24 * 60 * 60 * 1000;
const at = (entry: { date: string }) => new Date(`${entry.date}T00:00:00`).getTime();

describe('listRecentWhatsNew', () => {
  it('nunca devolve mais que o teto, mesmo com o histórico inteiro carregado', () => {
    expect(WHATS_NEW_ENTRIES.length).toBeGreaterThan(WHATS_NEW_MAX_ENTRIES);
    expect(listRecentWhatsNew().length).toBeLessThanOrEqual(WHATS_NEW_MAX_ENTRIES);
  });

  it('devolve da mais recente para a mais antiga', () => {
    const times = listRecentWhatsNew().map(at);
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);
    }
  });

  it('nenhuma entrada acima da idade máxima aparece', () => {
    // Referência fixa: um "agora" muito posterior a todo o histórico atual esvazia a lista.
    const bemDepois = new Date(at(WHATS_NEW_ENTRIES[0]) + (WHATS_NEW_MAX_AGE_DAYS + 30) * DAY_MS);
    expect(listRecentWhatsNew(bemDepois)).toEqual([]);

    // E no dia da entrada mais nova, tudo que sobra está dentro da janela.
    const noDia = new Date(at(WHATS_NEW_ENTRIES[0]));
    const cutoff = noDia.getTime() - WHATS_NEW_MAX_AGE_DAYS * DAY_MS;
    for (const entry of listRecentWhatsNew(noDia)) {
      expect(at(entry)).toBeGreaterThanOrEqual(cutoff);
    }
  });

  it('a entrada fora de ordem do arquivo não escapa da ordenação', () => {
    // O array é escrito à mão com inserção no topo; hoje já existe uma entrada fora de
    // lugar. A ordenação é o que garante o "mais recente primeiro" mesmo assim.
    const arquivo = WHATS_NEW_ENTRIES.map(at);
    const ordenado = [...arquivo].sort((a, b) => b - a);
    expect(arquivo).not.toEqual(ordenado); // se um dia arrumarem o arquivo, isto avisa
    expect(listRecentWhatsNew().map(at)).toEqual(ordenado.slice(0, WHATS_NEW_MAX_ENTRIES));
  });

  it('entradas do mesmo dia preservam a ordem em que foram escritas', () => {
    const recentes = listRecentWhatsNew();
    const mesmoDia = recentes.filter(e => e.date === recentes[0].date).map(e => e.id);
    const noArquivo = WHATS_NEW_ENTRIES.filter(e => e.date === recentes[0].date).map(e => e.id);
    expect(mesmoDia).toEqual(noArquivo.slice(0, mesmoDia.length));
  });

  it('não muta o histórico de origem', () => {
    const antes = WHATS_NEW_ENTRIES.map(e => e.id);
    listRecentWhatsNew();
    expect(WHATS_NEW_ENTRIES.map(e => e.id)).toEqual(antes);
  });
});
