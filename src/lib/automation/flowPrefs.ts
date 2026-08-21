// Preferências locais do editor visual — só no navegador, nunca no banco.
// "Blocos recentes" é exatamente o tipo de preferência que o brief (§8) permite
// guardar localmente: não é dado da automação, é conveniência de quem está
// montando o fluxo NESTA máquina.

const RECENTS_KEY = 'ib-automation-recent-blocks';
const MAX_RECENTS = 5;

export function readRecentBlockKeys(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberBlockKey(key: string): void {
  try {
    const current = readRecentBlockKeys().filter(k => k !== key);
    localStorage.setItem(RECENTS_KEY, JSON.stringify([key, ...current].slice(0, MAX_RECENTS)));
  } catch {
    // localStorage indisponível (modo privado, quota) — a biblioteca funciona sem "recentes".
  }
}
