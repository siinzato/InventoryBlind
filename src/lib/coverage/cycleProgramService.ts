// Programa de ciclagem — leitura e gravação da configuração.
//
// O lote do dia NÃO vem daqui: ele é calculado em `cycleProgramDomain.planDailyBatch` a
// partir dos itens que a Cobertura já lê. Este módulo cuida só das quatro cadências, da
// capacidade diária e da chave liga/desliga.
//
// ── Empresa sem linha gravada ───────────────────────────────────────────────
// Devolve os padrões em vez de erro. Isso mantém a tela utilizável desde o primeiro acesso,
// antes de alguém configurar qualquer coisa — e, como `enabled` nasce falso, ver os padrões
// não liga nada.

import { supabase } from '../supabase';
import {
  DEFAULT_CYCLE_CONFIG, normalizeConfig, type CycleProgramConfig,
} from './cycleProgramDomain';

const TABELA = 'cycle_program_settings';

interface SettingsRow {
  enabled: boolean | null;
  cadence_days_a: number | null;
  cadence_days_b: number | null;
  cadence_days_c: number | null;
  cadence_days_unclassified: number | null;
  daily_capacity: number | null;
}

const COLUNAS =
  'enabled, cadence_days_a, cadence_days_b, cadence_days_c, cadence_days_unclassified, daily_capacity';

function paraConfig(row: SettingsRow): CycleProgramConfig {
  return normalizeConfig({
    enabled: row.enabled ?? false,
    cadenceDays: {
      A: row.cadence_days_a ?? DEFAULT_CYCLE_CONFIG.cadenceDays.A,
      B: row.cadence_days_b ?? DEFAULT_CYCLE_CONFIG.cadenceDays.B,
      C: row.cadence_days_c ?? DEFAULT_CYCLE_CONFIG.cadenceDays.C,
      sem: row.cadence_days_unclassified ?? DEFAULT_CYCLE_CONFIG.cadenceDays.sem,
    },
    dailyCapacity: row.daily_capacity ?? DEFAULT_CYCLE_CONFIG.dailyCapacity,
  });
}

export interface LoadedConfig {
  config: CycleProgramConfig;
  /** `false` quando a empresa ainda não configurou nada e está vendo os padrões. A tela
   *  precisa dessa distinção: "30 SKUs por dia" escolhido por alguém e "30 SKUs por dia"
   *  porque ninguém mexeu não merecem a mesma apresentação. */
  saved: boolean;
}

export async function fetchCycleProgramConfig(companyId: string): Promise<LoadedConfig> {
  const { data, error } = await supabase
    .from(TABELA)
    .select(COLUNAS)
    .eq('company_id', companyId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return { config: DEFAULT_CYCLE_CONFIG, saved: false };
  return { config: paraConfig(data as SettingsRow), saved: true };
}

/** Grava a configuração da empresa.
 *
 *  `upsert` com `onConflict: 'company_id'` porque a primeira gravação cria a linha e as
 *  seguintes a substituem — e as duas são, para quem está na tela, o mesmo botão "Salvar".
 *
 *  Normaliza antes de enviar: os CHECK da tabela recusariam um valor fora da faixa com um
 *  erro de banco, e a pessoa veria uma mensagem técnica em vez do valor ajustado. */
export async function saveCycleProgramConfig(
  companyId: string,
  config: CycleProgramConfig
): Promise<CycleProgramConfig> {
  const limpa = normalizeConfig(config);

  const { error } = await supabase.from(TABELA).upsert(
    {
      company_id: companyId,
      enabled: limpa.enabled,
      cadence_days_a: limpa.cadenceDays.A,
      cadence_days_b: limpa.cadenceDays.B,
      cadence_days_c: limpa.cadenceDays.C,
      cadence_days_unclassified: limpa.cadenceDays.sem,
      daily_capacity: limpa.dailyCapacity,
    },
    { onConflict: 'company_id' }
  );

  if (error) throw error;
  return limpa;
}
