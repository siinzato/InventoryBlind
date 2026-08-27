// Heurística pura para o badge "Possivelmente suspeita". Deliberadamente
// conservadora: nunca classifica como suspeita só porque um dado está
// ausente (país não resolvido, por exemplo) — isso puniria justamente as
// sessões sobre as quais sabemos menos, o oposto do que uma heurística de
// segurança deveria fazer.

export interface HeuristicSessionInput {
  sessionId: string;
  userId: string;
  /** Epoch ms da última atividade (refreshed_at, ou created_at na ausência dele). */
  lastActivityMs: number;
  /** Código de país (ISO 3166-1 alpha-2) resolvido via geolocalização, ou null se indisponível. */
  countryCode: string | null;
  /** Outro sinal objetivo já fornecido pelo provedor (ex.: "proxy conhecido"). */
  objectiveSignal?: string | null;
}

export interface HeuristicResult {
  sessionId: string;
  suspicious: boolean;
  reason: string | null;
}

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Marca como suspeita apenas quando: (a) o mesmo usuário tem 2+ sessões
 *  recentes (dentro de `windowMs`) com países resolvidos e diferentes entre
 *  si, ou (b) a sessão carrega um sinal objetivo explícito do provedor. */
export function evaluateSuspiciousSessions(
  sessions: HeuristicSessionInput[],
  nowMs: number,
  windowMs: number = DEFAULT_WINDOW_MS,
): HeuristicResult[] {
  const byUser = new Map<string, HeuristicSessionInput[]>();
  for (const s of sessions) {
    const list = byUser.get(s.userId) ?? [];
    list.push(s);
    byUser.set(s.userId, list);
  }

  const crossCountryReason = new Map<string, string>();

  for (const userSessions of byUser.values()) {
    const recentWithCountry = userSessions.filter(
      s => s.countryCode && nowMs - s.lastActivityMs <= windowMs,
    );
    const countries = new Set(recentWithCountry.map(s => s.countryCode as string));
    if (countries.size >= 2) {
      const label = [...countries].sort().join(', ');
      for (const s of recentWithCountry) {
        crossCountryReason.set(s.sessionId, `Sessões simultâneas recentes em países diferentes (${label}).`);
      }
    }
  }

  return sessions.map((s): HeuristicResult => {
    const objective = s.objectiveSignal?.trim();
    if (objective) {
      return { sessionId: s.sessionId, suspicious: true, reason: objective };
    }
    const reason = crossCountryReason.get(s.sessionId);
    if (reason) {
      return { sessionId: s.sessionId, suspicious: true, reason };
    }
    return { sessionId: s.sessionId, suspicious: false, reason: null };
  });
}
