// Guardas das regras do suporte.
//
// O que mais importa aqui: o espelho da permissão do banco (conferente não abre
// chamado ao InventoryBlind) e a assimetria de "precisa de atenção" — o mesmo
// chamado cobra um lado e não cobra o outro.

import { describe, expect, it } from 'vitest';
import {
  attachmentPath, buildContext, canOpenProductTicket, channelsFor, countNeedingAttention,
  needsAttention, rejectionForFile, resolutionLabel, sortForInbox, sortForMine,
  validateBody, validateSubject, type SupportPriority, type SupportStatus,
} from '../supportDomain';

const t = (
  id: string, status: SupportStatus, priority: SupportPriority = 'normal',
  createdAt = '2026-10-01T00:00:00Z', updatedAt = '2026-10-01T00:00:00Z',
) => ({ id, status, priority, createdAt, updatedAt });

describe('quem pode abrir chamado ao InventoryBlind', () => {
  it('proprietário e administrador podem', () => {
    expect(canOpenProductTicket('owner')).toBe(true);
    expect(canOpenProductTicket('admin')).toBe(true);
  });

  // Espelho de support_ticket_open. Se divergir, a tela oferece um botão que o
  // banco recusa — e o usuário leva um erro no rosto depois de digitar tudo.
  it('os demais papéis não podem', () => {
    for (const role of ['manager', 'lead', 'counter', 'viewer', null, undefined]) {
      expect(canOpenProductTicket(role)).toBe(false);
    }
  });

  it('todo papel abre chamado interno', () => {
    expect(channelsFor('counter')).toEqual(['interno']);
    expect(channelsFor('owner')).toEqual(['produto', 'interno']);
  });
});

describe('o que pede atenção depende de que lado você está', () => {
  it('quem responde é cobrado enquanto não respondeu', () => {
    expect(needsAttention('aberto', 'answerer')).toBe(true);
    expect(needsAttention('em_analise', 'answerer')).toBe(true);
    expect(needsAttention('respondido', 'answerer')).toBe(false);
  });

  it('quem abriu é cobrado depois da resposta', () => {
    expect(needsAttention('respondido', 'author')).toBe(true);
    expect(needsAttention('aberto', 'author')).toBe(false);
  });

  it('resolvido não cobra ninguém', () => {
    expect(needsAttention('resolvido', 'author')).toBe(false);
    expect(needsAttention('resolvido', 'answerer')).toBe(false);
  });

  it('o contador conta pelo lado de quem olha', () => {
    const lista = [t('a', 'aberto'), t('b', 'respondido'), t('c', 'resolvido')];
    expect(countNeedingAttention(lista, 'answerer')).toBe(1);
    expect(countNeedingAttention(lista, 'author')).toBe(1);
  });
});

describe('ordem da fila de quem responde', () => {
  it('o que ninguém tocou vem antes do que já foi respondido', () => {
    const r = sortForInbox([t('respondido', 'respondido'), t('aberto', 'aberto')]);
    expect(r.map(x => x.id)).toEqual(['aberto', 'respondido']);
  });

  it('prioridade alta na frente, e dentro dela o mais antigo primeiro', () => {
    const r = sortForInbox([
      t('normal-velho', 'aberto', 'normal', '2026-01-01T00:00:00Z'),
      t('alta-nova', 'aberto', 'alta', '2026-09-01T00:00:00Z'),
      t('alta-velha', 'aberto', 'alta', '2026-02-01T00:00:00Z'),
    ]);
    expect(r.map(x => x.id)).toEqual(['alta-velha', 'alta-nova', 'normal-velho']);
  });

  // Resolvido empurrado para o fim mesmo sendo o mais recente: a caixa é para
  // trabalhar, não para contemplar o que já acabou.
  it('resolvido vai para o fim mesmo sendo o mais recente', () => {
    const r = sortForInbox([
      t('resolvido', 'resolvido', 'alta', '2026-10-10T00:00:00Z', '2026-10-10T00:00:00Z'),
      t('aberto', 'aberto', 'baixa', '2026-01-01T00:00:00Z'),
    ]);
    expect(r.map(x => x.id)).toEqual(['aberto', 'resolvido']);
  });

  it('não altera o array recebido', () => {
    const lista = [t('b', 'respondido'), t('a', 'aberto')];
    sortForInbox(lista);
    expect(lista.map(x => x.id)).toEqual(['b', 'a']);
  });
});

describe('ordem da lista de quem abriu', () => {
  // Prioridade é um pedido feito ao outro lado, não critério de leitura do
  // próprio histórico: aqui manda o movimento mais recente.
  it('o movimento mais recente no topo, sem olhar prioridade', () => {
    const r = sortForMine([
      t('velho', 'aberto', 'alta', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
      t('novo', 'resolvido', 'baixa', '2026-01-01T00:00:00Z', '2026-10-01T00:00:00Z'),
    ]);
    expect(r.map(x => x.id)).toEqual(['novo', 'velho']);
  });
});

describe('quem fechou o chamado', () => {
  it('nada a dizer enquanto está aberto', () => {
    expect(resolutionLabel({ status: 'aberto', resolvedBy: null }, 'u1', 'u1')).toBeNull();
  });

  it('distingue confirmação de quem abriu de encerramento de quem respondeu', () => {
    expect(resolutionLabel({ status: 'resolvido', resolvedBy: 'autor' }, 'outro', 'autor'))
      .toBe('Confirmado por quem abriu');
    expect(resolutionLabel({ status: 'resolvido', resolvedBy: 'suporte' }, 'outro', 'autor'))
      .toBe('Encerrado por quem respondeu');
  });

  it('fala na segunda pessoa com quem fechou', () => {
    expect(resolutionLabel({ status: 'resolvido', resolvedBy: 'eu' }, 'eu', 'eu'))
      .toBe('Resolvido por você');
  });
});

describe('validação do formulário', () => {
  it('assunto curto ou só espaço é recusado', () => {
    expect(validateSubject('ab')).not.toBeNull();
    expect(validateSubject('     ')).not.toBeNull();
    expect(validateSubject('Erro ao salvar')).toBeNull();
  });

  it('corpo vazio é recusado e longo demais também', () => {
    expect(validateBody('   ')).not.toBeNull();
    expect(validateBody('a'.repeat(5001))).not.toBeNull();
    expect(validateBody('aconteceu isso')).toBeNull();
  });

  it('anexo só imagem e só até 10 MB', () => {
    expect(rejectionForFile({ type: 'application/pdf', size: 1000 })).not.toBeNull();
    expect(rejectionForFile({ type: 'image/png', size: 11 * 1024 * 1024 })).not.toBeNull();
    expect(rejectionForFile({ type: 'image/png', size: 1000 })).toBeNull();
  });
});

describe('contexto do chamado', () => {
  it('campo ausente vira texto honesto, nunca vazio', () => {
    const c = buildContext({ tela: null, papel: null, empresa: null, navegador: 'UA', largura: 390.4, altura: 844 });
    expect(c.tela).toBe('não identificada');
    expect(c.papel).toBe('não informado');
    expect(c.janela).toBe('390x844');
  });

  // User agent gigante vira um campo que ninguém lê e uma linha que estoura a
  // tela do chamado.
  it('navegador é cortado', () => {
    expect(buildContext({
      tela: 'x', papel: 'owner', empresa: 'AZ', navegador: 'u'.repeat(1000), largura: 1, altura: 1,
    }).navegador).toHaveLength(300);
  });
});

describe('caminho do anexo', () => {
  // O prefixo é o que a policy de upload confere; errar aqui é upload recusado.
  it('começa pela empresa e mantém a extensão', () => {
    expect(attachmentPath('empresa-1', 'Print da Tela.PNG', 1700, 0)).toBe('empresa-1/1700-0.png');
  });

  it('nome sem extensão ou com lixo cai em png', () => {
    expect(attachmentPath('e', 'print', 1, 2)).toBe('e/1-2.png');
    expect(attachmentPath('e', 'print.!!!', 1, 0)).toBe('e/1-0.png');
  });
});
