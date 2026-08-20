// Rotas públicas dos documentos legais.
//
// O projeto NÃO tem router (nenhum react-router, nenhum tratamento de
// pathname): a navegação inteira é por estado em App.tsx/AuthPage.tsx. Instalar
// um router só para duas páginas estáticas seria dependência nova e mudança
// estrutural num fluxo de autenticação que está sendo mexido.
//
// A solução é ler o pathname uma vez, em main.tsx, ANTES de montar o app e o
// AuthProvider — o que é justamente o que garante acesso sem login. Os links
// internos são `<a href>` de verdade, então recarregam a página; para documento
// legal isso é aceitável e elimina toda a máquina de history/popstate.

export const LEGAL_ROUTES = {
  privacy: '/privacidade',
  terms: '/termos',
} as const;

export type LegalRoute = keyof typeof LEGAL_ROUTES;

/** Qual documento a URL atual pede, ou `null` se não for uma rota legal.
 *
 *  Tolera barra final e diferença de caixa; ignora query e hash, que o pathname
 *  já não inclui. Sem isso, `/termos/` cairia no app em vez do documento. */
export function matchLegalRoute(pathname: string): LegalRoute | null {
  const normalized = pathname.toLowerCase().replace(/\/+$/, '');
  for (const [route, path] of Object.entries(LEGAL_ROUTES) as [LegalRoute, string][]) {
    if (normalized === path) return route;
  }
  return null;
}

export function currentLegalRoute(): LegalRoute | null {
  if (typeof window === 'undefined') return null;
  return matchLegalRoute(window.location.pathname);
}
