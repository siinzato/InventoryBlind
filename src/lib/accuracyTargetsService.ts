// Meta de acuracidade (IRA) da empresa — leitura e escrita (migration 126).
//
// A régua em si é pura e vive em accuracyScale.ts. Este arquivo só busca os
// cortes da empresa e os grava — mesma separação de camadas já usada por
// recountPolicy.ts / physicalCountService.ts.
//
// Empresa sem linha devolve DEFAULT_ACCURACY_TARGETS (95/80). Isso não é um
// fallback defensivo: é o comportamento documentado na migration, e é o que
// mantém intacto o que a AZ vê hoje enquanto ninguém configurar.

import { supabase } from './supabase';
import { DEFAULT_ACCURACY_TARGETS, validateAccuracyTargets } from './accuracyScale';
import type { AccuracyTargets } from './accuracyScale';

export async function getAccuracyTargets(): Promise<AccuracyTargets> {
  const { data, error } = await supabase
    .from('accuracy_target_settings')
    .select('target_pct, warning_floor_pct')
    .maybeSingle();

  if (error) throw error;
  if (!data) return DEFAULT_ACCURACY_TARGETS;

  const alvo = {
    targetPct: Number(data.target_pct),
    warningFloorPct: Number(data.warning_floor_pct),
  };

  // O CHECK do banco já impede piso >= meta, mas uma linha ilegível (coluna nula,
  // NaN vindo de um numeric corrompido) viraria uma régua que classifica tudo
  // como crítico sem nenhum sinal. Nesse caso o default é mais honesto.
  return validateAccuracyTargets(alvo) === null ? alvo : DEFAULT_ACCURACY_TARGETS;
}

/** Grava a meta da empresa.
 *
 *  Upsert porque a linha pode não existir: company_id tem
 *  `DEFAULT get_my_company_id()::uuid`, então o tenant é resolvido pelo banco e a
 *  policy de INSERT exige que o valor resultante bata com a empresa do JWT. */
export async function saveAccuracyTargets(targets: AccuracyTargets): Promise<void> {
  const erro = validateAccuracyTargets(targets);
  if (erro) throw new Error(erro);

  const { data: companyId, error: companyError } = await supabase.rpc('get_my_company_id');
  if (companyError) throw companyError;
  if (!companyId) throw new Error('Nenhuma empresa ativa na sessão.');

  const { error } = await supabase.from('accuracy_target_settings').upsert(
    {
      company_id: companyId as string,
      target_pct: targets.targetPct,
      warning_floor_pct: targets.warningFloorPct,
    },
    { onConflict: 'company_id' }
  );

  if (error) throw error;
}
