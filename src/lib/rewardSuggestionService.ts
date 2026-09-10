// Sugestão de prêmio — o sistema apenas sugere um texto, nunca processa pagamento.

import { AchievementLevel } from './supabase';

const SUGGESTIONS: Record<AchievementLevel, string[]> = {
  bronze: ['Medalha digital', 'Certificado de reconhecimento', 'Reconhecimento em reunião de equipe'],
  prata: ['Certificado de reconhecimento', 'Vale-presente simbólico', 'Almoço em equipe'],
  ouro: ['Gift Card', 'Pix simbólico', 'Folga extra'],
  diamante: ['Bônus', 'Vale-presente', 'Folga extra + reconhecimento público'],
};

export function suggestReward(level: AchievementLevel): string[] {
  return SUGGESTIONS[level];
}

/** Picks the highest achievement level the employee currently holds, to drive the default reward suggestion. */
export function highestUnlockedLevel(levels: AchievementLevel[]): AchievementLevel | null {
  const order: AchievementLevel[] = ['diamante', 'ouro', 'prata', 'bronze'];
  return order.find(l => levels.includes(l)) ?? null;
}
