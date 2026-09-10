import { describe, expect, it } from 'vitest';
import { buildRouteRegistry, findRouteOption, type NavGroupLike } from '../routeRegistry';

const GROUPS: NavGroupLike[] = [
  { id: 'ops', items: [
    { id: 'nfe-conference', label: 'Conferência por NF-e', icon: null },
    { id: 'import-history', label: 'Histórico de Importações', icon: null },
    { id: 'locked-item', label: 'Bloqueado', icon: null, locked: true },
  ] },
  { id: 'locked-group', locked: true, items: [
    { id: 'em-breve', label: 'Em breve', icon: null },
  ] },
];

describe('buildRouteRegistry', () => {
  it('inclui só itens destravados de grupos destravados', () => {
    const registry = buildRouteRegistry(GROUPS);
    expect(registry.map(r => r.id)).toEqual(['nfe-conference', 'import-history']);
  });

  it('nunca inclui item de grupo travado, mesmo que o item não esteja marcado locked', () => {
    const registry = buildRouteRegistry(GROUPS);
    expect(registry.some(r => r.id === 'em-breve')).toBe(false);
  });

  it('nova rota destravada aparece sem alterar código do registro (dado dirige tudo)', () => {
    const withNew: NavGroupLike[] = [
      ...GROUPS,
      { id: 'novo-grupo', items: [{ id: 'nova-rota', label: 'Nova Função', icon: null }] },
    ];
    expect(buildRouteRegistry(withNew).map(r => r.id)).toContain('nova-rota');
  });
});

describe('findRouteOption', () => {
  it('encontra pelo id', () => {
    const registry = buildRouteRegistry(GROUPS);
    expect(findRouteOption(registry, 'import-history')?.label).toBe('Histórico de Importações');
  });

  it('retorna null quando a rota não existe mais no registro (permissão mudou)', () => {
    const registry = buildRouteRegistry(GROUPS);
    expect(findRouteOption(registry, 'locked-item')).toBeNull();
  });
});
