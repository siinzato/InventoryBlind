// Sinal efêmero de "tentou usar uma função bloqueada por outro plano" — usado só
// pela regra de elegibilidade do convite ao diagnóstico (dashboardDiagnosticRule.ts).
// Guardado em localStorage, por dispositivo, com validade curta — não é uma
// contagem nem um evento de auditoria, só um lembrete de curto prazo para o
// próprio dashboard.
//
// Nenhum ponto do produto chama `recordBlockedFeatureInterest` hoje: não existe,
// no código atual, nenhuma trava de recurso por PLANO (só por papel/permissão,
// que já tem seu próprio fluxo em AccessDeniedPage). Esta função fica pronta para
// quando esse tipo de trava existir — chamá-la faz parte de implementar aquela
// trava, não desta tarefa.

const KEY = 'ib_blocked_feature_interest';
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface BlockedFeatureInterest {
  featureKey: string;
  at: string;
}

export function recordBlockedFeatureInterest(featureKey: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ featureKey, at: new Date().toISOString() } satisfies BlockedFeatureInterest));
  } catch {
    // Navegação privada ou storage cheio — não é crítico.
  }
}

export function readBlockedFeatureInterest(maxAgeMs = DEFAULT_MAX_AGE_MS, now = new Date()): BlockedFeatureInterest | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BlockedFeatureInterest>;
    if (!parsed?.featureKey || !parsed.at) return null;
    if (now.getTime() - new Date(parsed.at).getTime() > maxAgeMs) return null;
    return { featureKey: parsed.featureKey, at: parsed.at };
  } catch {
    return null;
  }
}

export function clearBlockedFeatureInterest(): void {
  try { localStorage.removeItem(KEY); } catch { /* idem */ }
}
