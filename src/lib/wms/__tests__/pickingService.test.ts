// A parte da importação que dá para conferir sem banco.
//
// O que está em jogo: a lista colada é a PORTA de entrada da demanda. Linha mal lida
// aqui vira caixa a mais ou a menos no corredor, e ninguém descobre antes da separação.

import { describe, expect, it } from 'vitest';
import { interpretarLista, paradasPendentes, ROTULO_DO_ESTADO, type ParadaDaOnda } from '../pickingService';

describe('interpretarLista — o que sai de planilha, WhatsApp e e-mail', () => {
  it('aceita espaco, ponto-e-virgula, virgula e tabulacao', () => {
    // Obrigar um separador unico faria o operador editar a lista a mao antes de colar.
    const r = interpretarLista('SKU-1 10\nSKU-2;5\nSKU-3,2\nSKU-4\t7');
    expect(r.linhas).toEqual([
      { codigo: 'SKU-1', caixas: 10 },
      { codigo: 'SKU-2', caixas: 5 },
      { codigo: 'SKU-3', caixas: 2 },
      { codigo: 'SKU-4', caixas: 7 },
    ]);
    expect(r.recusadas).toEqual([]);
  });

  it('a quantidade e o ULTIMO campo, e o resto e o codigo', () => {
    // Nome de produto com espaco no meio e comum; quantidade no fim e como toda
    // planilha de separacao se escreve.
    const r = interpretarLista('BOLSA TOTE MINI LILAS 3');
    expect(r.linhas).toEqual([{ codigo: 'BOLSA TOTE MINI LILAS', caixas: 3 }]);
  });

  it('ignora linhas em branco e espaco solto', () => {
    const r = interpretarLista('\n  \nSKU-1 1\n\n   SKU-2   2   \n');
    expect(r.linhas).toHaveLength(2);
    expect(r.recusadas).toEqual([]);
  });

  it('linha ruim NAO interrompe a importacao', () => {
    // Abortar tudo por causa da linha 3 obrigaria a recomecar do zero — e quem esta com
    // pressa apaga a linha 3 e perde a demanda dela.
    const r = interpretarLista('SKU-1 10\nSKU-2 5\nSKU-SOZINHO\nSKU-4 2');
    expect(r.linhas.map(l => l.codigo)).toEqual(['SKU-1', 'SKU-2', 'SKU-4']);
    expect(r.recusadas).toEqual([
      { linha: 3, texto: 'SKU-SOZINHO', motivo: 'sem_quantidade' },
    ]);
  });

  it('a linha recusada volta com o NUMERO original, nao com o indice do filtro', () => {
    // Sem o numero da linha de origem, "corrija a linha 2" aponta para a linha errada no
    // texto que a pessoa colou.
    const r = interpretarLista('\n\nSKU-A 1\nSKU-RUIM x\n');
    expect(r.recusadas).toEqual([
      { linha: 4, texto: 'SKU-RUIM x', motivo: 'quantidade_invalida' },
    ]);
  });

  it('recusa quantidade que nao e inteiro positivo', () => {
    // Caixa fracionada nao existe na prateleira, e zero nao e demanda.
    const r = interpretarLista('A 0\nB -3\nC 2.5\nD abc\nE 4');
    expect(r.linhas).toEqual([{ codigo: 'E', caixas: 4 }]);
    expect(r.recusadas.map(x => x.motivo)).toEqual([
      'quantidade_invalida', 'quantidade_invalida', 'quantidade_invalida', 'quantidade_invalida',
    ]);
  });

  it('numero solto antes da quantidade e AMBIGUO e volta para quem colou', () => {
    // A virgula e separador de campo (CSV) e separador decimal (planilha pt-BR). Em
    // `A 10,5` as duas leituras sao indistinguiveis: 5 caixas ou 10,5 caixas. Ler como 5
    // entregaria metade da demanda sem avisar — erro que so aparece no corredor.
    const r = interpretarLista('A 10,5\nA 10,0\nB 10 5');
    expect(r.linhas).toEqual([]);
    expect(r.recusadas.map(x => x.motivo)).toEqual(['ambigua', 'ambigua', 'ambigua']);
  });

  it('separador explicito com codigo terminado em numero continua valendo', () => {
    // `TBGCM55-14,3` e o formato real deste cadastro: o codigo nao e numero solto.
    const r = interpretarLista('TBGCM55-14,3\nGFGCM13-20;7');
    expect(r.linhas).toEqual([
      { codigo: 'TBGCM55-14', caixas: 3 },
      { codigo: 'GFGCM13-20', caixas: 7 },
    ]);
    expect(r.recusadas).toEqual([]);
  });

  it('texto vazio devolve listas vazias, sem explodir', () => {
    expect(interpretarLista('')).toEqual({ linhas: [], recusadas: [] });
    expect(interpretarLista('   \n  ')).toEqual({ linhas: [], recusadas: [] });
  });
});

describe('paradasPendentes — a lista que o operador percorre', () => {
  const parada = (p: Partial<ParadaDaOnda>): ParadaDaOnda => ({
    alocacaoId: 'a', sequencia: 1, estado: 'pendente', endereco: 'PP-A01-N1',
    enderecoBloqueado: false, itemId: 'i', produtoId: 'p', sku: 'S', produto: 'P',
    ean: null, caixas: 3, separadas: 0, restantes: 3, unidadesPorCaixa: 30,
    guardadoDesde: null, ...p,
  });

  it('mantem pendente e parcial, e descarta o que ja encerrou', () => {
    const rota = [
      parada({ alocacaoId: '1', estado: 'pendente', restantes: 3 }),
      parada({ alocacaoId: '2', estado: 'parcial', restantes: 2 }),
      parada({ alocacaoId: '3', estado: 'separado', restantes: 0 }),
      parada({ alocacaoId: '4', estado: 'ruptura', restantes: 1 }),
      parada({ alocacaoId: '5', estado: 'cancelado', restantes: 1 }),
    ];
    expect(paradasPendentes(rota).map(p => p.alocacaoId)).toEqual(['1', '2']);
  });

  it('parada sem nada a separar sai da lista mesmo aberta', () => {
    // Mandar o operador a um endereco de onde nao ha o que tirar e desperdicio gerado
    // pela tela.
    const rota = [parada({ estado: 'parcial', restantes: 0 })];
    expect(paradasPendentes(rota)).toEqual([]);
  });
});

describe('vocabulario', () => {
  it('todo estado da onda tem rotulo para a tela', () => {
    // Estado sem rotulo apareceria como `em_separacao` cru para o operador.
    expect(Object.keys(ROTULO_DO_ESTADO).sort()).toEqual(
      ['cancelada', 'concluida', 'em_separacao', 'parcial', 'rascunho', 'reservada'],
    );
    for (const rotulo of Object.values(ROTULO_DO_ESTADO)) {
      expect(rotulo).not.toMatch(/_/);
    }
  });
});
