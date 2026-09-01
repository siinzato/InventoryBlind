import { describe, expect, it } from 'vitest';
import {
  SIDEBAR_LAYOUT,
  computeSectionNumbers,
  groupIconName,
  itemIconName,
  visibleInlineItems,
  workspaceFallback,
  type SidebarNavGroup,
  type SidebarNavItem,
} from '../Sidebar';

// Este projeto não tem infraestrutura de teste de componente React
// (@testing-library/react/jsdom) em nenhum outro módulo — todo teste existente é sobre
// função pura ou texto de migration. Em vez de introduzir essa dependência só para esta
// troca de sidebar, os pedaços puros e testáveis da integração (numeração de seção,
// mapeamento de ícone por grupo/item, carimbo de workspace) são cobertos aqui; os
// comportamentos que exigem DOM (aria-expanded, tooltip por foco e animação) são
// verificados no navegador. As decisões estruturais que causaram a regressão
// visual ficam cobertas aqui para não voltarem silenciosamente.

function group(overrides: Partial<SidebarNavGroup> = {}): SidebarNavGroup {
  return { id: 'g', label: 'Grupo', items: [], ...overrides };
}

describe('computeSectionNumbers', () => {
  it('numera 01/02/03 seguindo as fronteiras reais de sectionLabel do App.tsx', () => {
    const groups: SidebarNavGroup[] = [
      group({ id: 'dashboard-group', sectionLabel: 'Visão Geral' }),
      group({ id: 'analytics-group' }),
      group({ id: 'counting-group', sectionLabel: 'Operação Inteligente' }),
      group({ id: 'automacoes-group' }),
      group({ id: 'products-group' }),
      group({ id: 'tools-group' }),
      group({ id: 'academy-group', sectionLabel: 'Aprendizado e Gestão' }),
      group({ id: 'account-group' }),
    ];
    expect(computeSectionNumbers(groups)).toEqual([1, 1, 2, 2, 2, 2, 3, 3]);
  });

  it('nunca produz seção 0, mesmo se o primeiro grupo não declarar sectionLabel', () => {
    const groups: SidebarNavGroup[] = [group({ id: 'a' }), group({ id: 'b', sectionLabel: 'X' })];
    expect(computeSectionNumbers(groups).every(n => n >= 1)).toBe(true);
  });
});

describe('contrato de densidade do desktop', () => {
  it('mantém o menu aberto compacto e o trilho retraído estreito', () => {
    expect(SIDEBAR_LAYOUT).toEqual({ expanded: 300, collapsed: 72, rail: 52 });
  });

  it('mostra no fluxo apenas o filho ativo, nunca a árvore inteira do grupo', () => {
    const items: SidebarNavItem[] = [
      { id: 'a', label: 'A', icon: null, onClick: () => {}, active: false },
      { id: 'b', label: 'B', icon: null, onClick: () => {}, active: true },
      { id: 'c', label: 'C', icon: null, onClick: () => {}, active: false },
    ];
    expect(visibleInlineItems(group({ items })).map(item => item.id)).toEqual(['b']);
  });

  it('não inventa uma linha de submenu quando o grupo não tem item ativo', () => {
    const items: SidebarNavItem[] = [
      { id: 'a', label: 'A', icon: null, onClick: () => {}, active: false },
      { id: 'b', label: 'B', icon: null, onClick: () => {}, active: false },
    ];
    expect(visibleInlineItems(group({ items }))).toEqual([]);
  });
});

describe('groupIconName / itemIconName — só ícones do kit (icons/), nunca Lucide', () => {
  it('mapeia cada grupo real de App.tsx para o ícone correspondente do kit', () => {
    expect(groupIconName('dashboard-group')).toBe('dashboard');
    expect(groupIconName('analytics-group')).toBe('analytics');
    expect(groupIconName('counting-group')).toBe('operations');
    expect(groupIconName('automacoes-group')).toBe('automations');
    expect(groupIconName('products-group')).toBe('products');
    expect(groupIconName('tools-group')).toBe('tools');
    expect(groupIconName('academy-group')).toBe('academy');
    expect(groupIconName('account-group')).toBe('account');
    expect(groupIconName('admin-group')).toBe('admin');
    expect(groupIconName('integracoes-group')).toBe('integrations');
    expect(groupIconName('config-avancada-group')).toBe('settings');
  });

  it('"Agentes e Automações" usa o ícone próprio (agents), não o do grupo Automações', () => {
    expect(itemIconName('automacoes-group', 'automacoes')).toBe('agents');
  });

  it('itens reais sem ícone dedicado no kit reaproveitam o ícone do próprio grupo (só usado no item ativo)', () => {
    expect(itemIconName('counting-group', 'input')).toBe('operations');
    expect(itemIconName('tools-group', 'tasks')).toBe('tools');
  });
});

describe('workspaceFallback', () => {
  it('usa apenas a inicial como fallback quando não existe logo enviado', () => {
    expect(workspaceFallback('AZ')).toBe('A');
    expect(workspaceFallback('Acme Logística')).toBe('A');
  });

  it('nunca gera iniciais predefinidas para um nome vazio', () => {
    expect(workspaceFallback('   ')).toBe('?');
  });
});
