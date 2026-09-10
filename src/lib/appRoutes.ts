// Fonte central de verdade da navegação: identificador do módulo (o mesmo `activeTab`
// que App.tsx já usava, e o mesmo `id` de cada item em navGroups) <-> caminho na URL.
//
// Por que um mapa e não um <Routes> com um <Route> por página: o render de App.tsx é
// uma cadeia de `activeTab === '...'` com ~50 ramos, cada um com props próprias
// (companyId, profile, pendingIds, callbacks entre módulos). Traduzir isso em rotas
// aninhadas seria reescrever o App inteiro. Com o mapa, a URL passa a ser a fonte de
// verdade — `activeTab` é derivado dela — sem tocar em nenhum dos ramos.
//
// Regra ao adicionar módulo novo: registre aqui. Um id fora deste mapa não tem URL e
// cai no dashboard.

export const APP_BASE = '/app';
export const DEFAULT_TAB = 'dashboard';

/** Módulo -> caminho. Os ids são exatamente os usados em App.tsx/navGroups. */
export const APP_ROUTE_BY_TAB: Record<string, string> = {
  // Visão geral
  dashboard: '/app/dashboard',
  heatmap: '/app/heatmap',
  kpis: '/app/kpis',
  rankings: '/app/rankings',
  'closing-results': '/app/resultados-por-linha',

  // Analytics
  'analytics-blindscore': '/app/analytics/blind-score',
  'analytics-health': '/app/analytics/saude-inventario',
  'analytics-ia': '/app/analytics/ia-insights',
  'analytics-audit': '/app/analytics/auditorias',

  // Operações
  input: '/app/operacoes/nova-contagem',
  'nfe-conference': '/app/operacoes/conferencia-nfe',
  'purchase-orders': '/app/operacoes/ordens-de-compra',
  'reverse-logistics': '/app/operacoes/logistica-reversa',
  cbc: '/app/operacoes/confidence-score',
  risk: '/app/operacoes/inventario-por-risco',
  abcxyz: '/app/operacoes/classificacao-abc-xyz',
  slotting: '/app/operacoes/warehouse-digital-twin',
  rca: '/app/operacoes/root-cause-analysis',
  audit: '/app/operacoes/auditoria-de-estoque',

  // Automações
  automacoes: '/app/automacoes',

  // Produtos
  products: '/app/produtos',
  'product-brands': '/app/produtos/linhas-marcas',
  import: '/app/produtos/importar',
  'import-history': '/app/produtos/importacoes',
  'balance-source': '/app/produtos/fonte-de-saldo',
  'abc-curve': '/app/produtos/curva-abc',

  // Ferramentas
  tasks: '/app/meu-trabalho',
  'nfe-xml-lookup': '/app/ferramentas/consulta-xml-nfe',
  'label-generator': '/app/ferramentas/etiquetas',
  'barcode-lab': '/app/ferramentas/codigos-de-barras',
  'spreadsheet-comparator': '/app/ferramentas/comparador-de-planilhas',
  // Mesma tela alcançada também de dentro de Nova Contagem — uma rota, uma implementação.
  'inventory-report': '/app/ferramentas/emitir-relatorio',
  'pdf-center': '/app/ferramentas/central-de-pdfs',
  'pallet-calc': '/app/ferramentas/paletizacao',
  'full-manager': '/app/ferramentas/full-manager',
  inventoryfull: '/app/ferramentas/inventoryfull',

  // Aprendizado e gestão
  academy: '/app/academy',
  conta: '/app/minha-conta/produtividade',
  knowledge: '/app/minha-conta/recursos',
  diagnostico: '/app/minha-conta/diagnostico',
  legal: '/app/minha-conta/privacidade-legal',

  // Administração
  admin: '/app/administracao/acesso',
  users: '/app/administracao/usuarios',

  // Integrações — o Hub é a entrada; 'integracoes' é a gestão do Tiny, que o Hub abre.
  'integracoes-hub': '/app/integracoes',
  integracoes: '/app/integracoes/tiny',

  // Configurações avançadas
  security: '/app/configuracoes/seguranca',
  'config-api': '/app/configuracoes/api',
  'config-webhooks': '/app/configuracoes/webhooks',
  'config-logs': '/app/configuracoes/logs',
  'config-empresas-fiscais': '/app/configuracoes/empresas-fiscais',
  'config-workspaces': '/app/configuracoes/workspaces',
};

const TAB_BY_APP_ROUTE: Record<string, string> = Object.fromEntries(
  Object.entries(APP_ROUTE_BY_TAB).map(([tab, path]) => [path, tab])
);

/** Views públicas com URL própria. `forgot`, `update-password` e `confirm-email` ficam
 *  fora de propósito: chegam por link de e-mail com token no hash, e dar caminho a elas
 *  arriscaria o fluxo de recuperação. */
export const PUBLIC_PATH_BY_VIEW: Record<string, string> = {
  landing: '/',
  login: '/login',
  signup: '/cadastro',
};

const VIEW_BY_PUBLIC_PATH: Record<string, string> = Object.fromEntries(
  Object.entries(PUBLIC_PATH_BY_VIEW).map(([view, path]) => [path, view])
);

/** Tira barra final e caixa alta; ignora query/hash (que pathname já não traz). */
export function normalizePath(pathname: string): string {
  const trimmed = pathname.toLowerCase().replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/** Caminho do módulo, ou `null` se o id não tiver rota registrada. */
export function pathForTab(tab: string): string | null {
  return APP_ROUTE_BY_TAB[tab] ?? null;
}

/** Módulo que a URL pede, ou `null` se não for uma rota de módulo. */
export function tabForPath(pathname: string): string | null {
  return TAB_BY_APP_ROUTE[normalizePath(pathname)] ?? null;
}

/** A URL está dentro do aplicativo autenticado? Usado para não mostrar a Homepage
 *  em quem abriu `/app/...` direto numa guia nova. */
export function isAppPath(pathname: string): boolean {
  const normalized = normalizePath(pathname);
  return normalized === APP_BASE || normalized.startsWith(`${APP_BASE}/`);
}

/** View pública que a URL pede, ou `null`. */
export function publicViewForPath(pathname: string): string | null {
  return VIEW_BY_PUBLIC_PATH[normalizePath(pathname)] ?? null;
}

/** O clique deve ser tratado pelo navegador (nova guia, nova janela, download)
 *  em vez de virar navegação SPA? Mesma checagem que o <Link> do React Router faz:
 *  é o que faz Ctrl/Cmd+clique, Shift+clique e botão do meio funcionarem de graça. */
export function isModifiedClick(event: {
  button?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
}): boolean {
  return (
    event.defaultPrevented === true ||
    (event.button !== undefined && event.button !== 0) ||
    !!event.metaKey ||
    !!event.ctrlKey ||
    !!event.shiftKey ||
    !!event.altKey
  );
}
