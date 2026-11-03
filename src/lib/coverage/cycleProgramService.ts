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
import { createSession } from '../physicalCount/physicalCountService';
import {
  cycleSessionObservation, cycleSessionProductIds, cycleSessionRange,
  DEFAULT_CYCLE_CONFIG, DEFAULT_CYCLE_SCHEDULE, normalizeConfig, type CycleProgramConfig, type DailyBatch,
} from './cycleProgramDomain';

const TABELA = 'cycle_program_settings';

interface SettingsRow {
  enabled: boolean | null;
  cadence_days_a: number | null;
  cadence_days_b: number | null;
  cadence_days_c: number | null;
  cadence_days_unclassified: number | null;
  daily_capacity: number | null;
  schedule_enabled: boolean | null;
  /** `smallint[]` no banco; o PostgREST devolve array de números. */
  schedule_weekdays: number[] | null;
  schedule_hour: number | null;
  schedule_timezone: string | null;
}

// Uma linha só, sem concatenação: o supabase-js lê o literal para tipar a resposta, e um
// `'a' + 'b'` o faz desistir e devolver um tipo genérico que o cast abaixo recusa.
const COLUNAS =
  'enabled, cadence_days_a, cadence_days_b, cadence_days_c, cadence_days_unclassified, daily_capacity, schedule_enabled, schedule_weekdays, schedule_hour, schedule_timezone';

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
    // `normalizeConfig` cuida do resto: lista de dias vazia, hora fora da faixa ou fuso em
    // branco viram o padrão, em vez de um agendamento ligado que nunca dispara.
    schedule: {
      enabled: row.schedule_enabled ?? false,
      weekdays: row.schedule_weekdays ?? DEFAULT_CYCLE_SCHEDULE.weekdays,
      hour: row.schedule_hour ?? DEFAULT_CYCLE_SCHEDULE.hour,
      timezone: row.schedule_timezone ?? DEFAULT_CYCLE_SCHEDULE.timezone,
    },
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
      schedule_enabled: limpa.schedule.enabled,
      schedule_weekdays: limpa.schedule.weekdays,
      schedule_hour: limpa.schedule.hour,
      schedule_timezone: limpa.schedule.timezone,
    },
    { onConflict: 'company_id' }
  );

  if (error) throw error;
  return limpa;
}

// ── Gerar a contagem do dia ─────────────────────────────────────────────────
//
// Reusa `pc_create_session` da Contagem Física — a mesma RPC que a tela de contagem chama.
// Ela já recebe a lista explícita de produtos e já valida a empresa de cada um no servidor,
// então a ciclagem não precisa de tabela, RPC nem permissão própria no banco: o lote do dia
// é uma contagem física comum, criada com um recorte diferente.

export interface OpenCycleSession {
  id: string;
  totalItems: number;
  status: string;
}

/** A contagem de ciclagem de hoje que ainda está aberta, se houver.
 *
 *  Existe para a tela não gerar o mesmo lote duas vezes — o acidente provável aqui não é
 *  má-fé, é o segundo clique ou duas pessoas abrindo a tela na mesma manhã. Duas sessões com
 *  os mesmos SKUs dividiriam a contagem do dia em duas listas concorrentes, e a segunda
 *  nasceria já errada: os itens da primeira ainda não foram contados, então continuariam
 *  vencidos.
 *
 *  Só sessões ABERTAS bloqueiam. Se a de hoje já foi finalizada, o histórico de contagem dos
 *  itens mudou e um lote novo é legitimamente diferente — recusar aí seria impedir a equipe
 *  de continuar trabalhando depois de terminar cedo. */
export async function findOpenCycleSession(
  companyId: string,
  now: Date
): Promise<OpenCycleSession | null> {
  const { from, to } = cycleSessionRange(now);

  const { data, error } = await supabase
    .from('physical_count_sessions')
    .select('id, total_items, status')
    .eq('company_id', companyId)
    .eq('street_from', from)
    .eq('street_to', to)
    .is('deleted_at', null)
    .in('status', ['draft', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw error;
  const linha = (data ?? [])[0];
  if (!linha) return null;
  return {
    id: linha.id as string,
    totalItems: (linha.total_items as number | null) ?? 0,
    status: linha.status as string,
  };
}

export interface CreatedCycleSession {
  sessionId: string;
  totalItems: number;
}

/** Cria a contagem do dia a partir do lote.
 *
 *  Nasce como RASCUNHO, e isso é deliberado: a tela de contagem inicia a sessão no mesmo
 *  clique porque quem cria ali é quem vai contar em seguida. Aqui não — quem gera o lote é
 *  quem gere, e a contagem pode ficar esperando a equipe por horas. Iniciar agora colocaria
 *  essa espera dentro da duração da contagem (`started_at`), que passaria a medir o atraso
 *  do turno em vez do trabalho. Quem for contar inicia na própria tela de Contagens.
 *
 *  Sem `responsibleId`: o lote é da equipe, não de uma pessoa. Atribuir a sessão a quem
 *  clicou faria o nome de um gestor aparecer como responsável por uma contagem que ele não
 *  vai fazer. */
export async function createCycleSession(batch: DailyBatch, now: Date): Promise<CreatedCycleSession> {
  const produtos = cycleSessionProductIds(batch);
  if (produtos.length === 0) {
    throw new Error('Não há nada no lote de hoje para gerar uma contagem.');
  }

  const { from, to } = cycleSessionRange(now);
  const sessionId = await createSession({
    warehouse: null,
    area: null,
    streetFrom: from,
    streetTo: to,
    responsibleId: null,
    observation: cycleSessionObservation(batch, now),
    productIds: produtos,
  });

  return { sessionId, totalItems: produtos.length };
}
