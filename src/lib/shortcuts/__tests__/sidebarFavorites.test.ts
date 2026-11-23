// A resolução dos favoritos da sidebar.
//
// O que está em jogo: um menu que a própria pessoa montou. Mandar ela para o destino
// errado a partir dali é pior que não ter o atalho — e as falhas aqui são silenciosas,
// porque um atalho que aponta para o lugar errado continua sendo um botão que navega.

import { describe, it, expect, vi } from 'vitest';
import { resolverFavoritos, type GrupoNavegavel } from '../sidebarFavorites';

interface Item {
  id: string;
  label: string;
  locked?: boolean;
  onClick: () => void;
  active: boolean;
}

const item = (id: string, over: Partial<Item> = {}): Item => ({
  id,
  label: id.toUpperCase(),
  onClick: vi.fn(),
  active: false,
  ...over,
});

const grupos = (...gs: GrupoNavegavel<Item>[]) => gs;

const atalho = (routeKey: string) => ({ routeKey });

describe('resolverFavoritos', () => {
  const menu = grupos(
    { id: 'visao', items: [item('dashboard'), item('analytics')] },
    { id: 'operacao', items: [item('wms-pulmao'), item('tasks')] },
  );

  it('devolve os itens correspondentes aos atalhos', () => {
    const r = resolverFavoritos([atalho('wms-pulmao'), atalho('dashboard')], menu);
    expect(r.map(i => i.id)).toEqual(['wms-pulmao', 'dashboard']);
  });

  it('PRESERVA a ordem salva — ela é a que a pessoa arrastou', () => {
    const r = resolverFavoritos([atalho('tasks'), atalho('analytics'), atalho('dashboard')], menu);
    expect(r.map(i => i.id)).toEqual(['tasks', 'analytics', 'dashboard']);
  });

  it('devolve o PRÓPRIO item do menu, com o onClick e o active dele', () => {
    // Reconstruir o clique aqui criaria um segundo caminho para o mesmo destino.
    const alvo = item('wms-pulmao', { active: true });
    const comAtivo = grupos({ id: 'operacao', items: [alvo] });
    const [resolvido] = resolverFavoritos([atalho('wms-pulmao')], comAtivo);
    expect(resolvido).toBe(alvo);
    expect(resolvido.active).toBe(true);
    resolvido.onClick();
    expect(alvo.onClick).toHaveBeenCalledTimes(1);
  });

  it('atalho para rota inexistente é ignorado, não vira item quebrado', () => {
    const r = resolverFavoritos([atalho('rota-que-sumiu'), atalho('tasks')], menu);
    expect(r.map(i => i.id)).toEqual(['tasks']);
  });

  it('item TRAVADO não vira favorito — é a mesma regra de permissão do menu', () => {
    const comTravado = grupos({ id: 'operacao', items: [item('beta', { locked: true }), item('tasks')] });
    const r = resolverFavoritos([atalho('beta'), atalho('tasks')], comTravado);
    expect(r.map(i => i.id)).toEqual(['tasks']);
  });

  it('grupo inteiro travado não entrega nenhum favorito', () => {
    const comGrupoTravado = grupos({ id: 'em-breve', locked: true, items: [item('futuro')] });
    expect(resolverFavoritos([atalho('futuro')], comGrupoTravado)).toEqual([]);
  });

  it('atalho repetido não manda a pessoa duas vezes ao mesmo lugar', () => {
    const r = resolverFavoritos([atalho('tasks'), atalho('tasks')], menu);
    expect(r.map(i => i.id)).toEqual(['tasks']);
  });

  it('sem atalhos, devolve lista vazia', () => {
    expect(resolverFavoritos([], menu)).toEqual([]);
  });

  it('menu vazio não quebra', () => {
    expect(resolverFavoritos([atalho('tasks')], [])).toEqual([]);
  });

  it('não inventa item quando o atalho casa com o id de um GRUPO, não de um item', () => {
    // 'operacao' e id de grupo; nunca deve ser navegavel como se fosse destino.
    expect(resolverFavoritos([atalho('operacao')], menu)).toEqual([]);
  });
});
