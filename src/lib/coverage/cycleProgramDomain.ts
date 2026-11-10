// Programa de ciclagem — as regras, sem nenhum acesso a dados.
//
// A Cobertura responde "como estamos". Este módulo responde "o que a equipe conta hoje".
// São perguntas diferentes: a primeira é um diagnóstico, a segunda é uma ordem de serviço
// que precisa caber num turno e não pode mudar de ideia no meio do dia.
//
// ── A decisão que define o módulo ────────────────────────────────────────────
// Um catálogo que nunca foi ciclado chega aqui com quase tudo sem contagem nenhuma. Se a
// fila do dia fosse uma ordenação única por prioridade, os itens nunca contados — que estão
// atrasados por definição — ganhariam de todo o resto TODOS OS DIAS, até acabarem. Em
// 4.600 SKUs a 30 por dia, isso são cinco meses em que nenhum item volta a ser contado uma
// segunda vez: o programa contaria o catálogo inteiro uma vez e só então começaria a
// ciclar, que é o oposto de ciclagem.
//
// Por isso a capacidade do dia é dividida em duas faixas com precedência explícita:
//
//   1. VENCIDOS — já foram contados alguma vez e estouraram a cadência da própria classe.
//      Entram primeiro porque são o ciclo funcionando, e perder a recontagem de um item A
//      para esvaziar backlog é desmontar o programa para alimentar a fila dele.
//   2. NUNCA CONTADOS — preenchem o que sobrar, do mais caro para o mais barato.
//
// O backlog avança mais devagar, e isso é intencional: ele é finito e acaba; a cadência,
// não. O módulo devolve em quantos dias o backlog zera no ritmo atual, para que essa
// lentidão seja um número na tela e não uma surpresa.
//
// Módulo puro: sem I/O, sem relógio. `now` sempre entra por parâmetro.

import { bucketOf, daysSince, type AbcBucket, type CoverageItem } from './coverageDomain';
import { plural } from '../../lib/formatPtBr';

/** Cadência por classe e tamanho do lote diário, por empresa.
 *
 *  A cadência é por classe da curva ABC porque é isso que a classe significa: um item que
 *  responde por 1% do valor movimentado não merece a mesma frequência de um que responde
 *  por 30%. `sem` existe para o produto sem curva apurada — não é uma quarta classe, é a
 *  ausência das três, e tratá-la junto com C esconderia quantos itens estão sem base. */
export interface CycleProgramConfig {
  /** Programa ligado. Nasce desligado: gerar trabalho para a equipe sozinho é decisão de
   *  quem gere, não efeito colateral de uma atualização. */
  enabled: boolean;
  cadenceDays: Record<AbcBucket, number>;
  /** Quantos SKUs a equipe consegue contar por dia.
   *
   *  O número que mais importa aqui, e o que a operação real já mostrou: das cinco sessões
   *  de contagem abertas nesta base, as de 1.164 e 121 itens foram abandonadas e a de 7
   *  foi a única concluída. Lote que não termina no turno não vira contagem — vira sessão
   *  aberta para sempre. */
  dailyCapacity: number;
  /** Quando o sistema lembra a equipe de que o lote do dia ainda não saiu. */
  schedule: CycleSchedule;
}

// ── Agendamento do lembrete ─────────────────────────────────────────────────
//
// O que é agendado é o LEMBRETE, não a geração. O lote continua sendo criado por uma
// pessoa, na tela, pelo caminho único que já existe — o servidor só percebe que o dia
// programado chegou e o lote de hoje ainda não saiu.
//
// Por que não gerar sozinho: o lote é calculado aqui, no navegador, cruzando catálogo,
// curva ABC, última contagem de duas origens e saldo da Fonte de Saldo. Para o servidor
// gerar por conta própria, essa regra teria de existir também em SQL — e duas
// implementações da mesma regra divergem em silêncio. O dia em que a tela mostrasse um
// lote e a rotina criasse outro, ninguém descobriria até alguém comparar os dois.

/** 0 = domingo, igual a `Date.getDay()` e a `EXTRACT(DOW)` do Postgres. A rotina do banco
 *  compara com o mesmo número, então mudar esta convenção exige mudar os dois lados. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAY_LABEL: Record<number, string> = {
  0: 'Domingo', 1: 'Segunda', 2: 'Terça', 3: 'Quarta', 4: 'Quinta', 5: 'Sexta', 6: 'Sábado',
};

export const WEEKDAY_SHORT: Record<number, string> = {
  0: 'Dom', 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb',
};

export interface CycleSchedule {
  /** Lembrete ligado. Nasce desligado, como o próprio programa: uma atualização não começa
   *  a cobrar a equipe sozinha. */
  enabled: boolean;
  /** Dias em que a contagem é esperada. Ordenado e sem repetição. */
  weekdays: number[];
  /** Hora local a partir da qual o lembrete vale para o dia. Não é o instante exato do
   *  disparo: a rotina do banco roda de hora em hora e avisa na primeira passagem a partir
   *  dessa hora, para que um atraso do agendador não engula o aviso do dia. */
  hour: number;
  /** Fuso em que "hoje" e "08:00" são lidos. Guardado por empresa, com o mesmo padrão do
   *  agendador de automações (053): em UTC, "às 08:00" chegaria às 5h da manhã aqui. */
  timezone: string;
}

export const DEFAULT_CYCLE_SCHEDULE: CycleSchedule = {
  enabled: false,
  // Segunda a sexta: contagem cíclica acompanha o turno, e o fim de semana sem equipe só
  // geraria aviso para ninguém ler na segunda.
  weekdays: [1, 2, 3, 4, 5],
  hour: 8,
  timezone: 'America/Sao_Paulo',
};

export const SCHEDULE_HOUR_MIN = 0;
export const SCHEDULE_HOUR_MAX = 23;

/** Normaliza o que veio do banco (ou de uma versão anterior da tela).
 *
 *  Lista de dias vazia volta para o padrão em vez de ficar vazia: um agendamento ligado
 *  que nunca pode disparar é pior que um desligado — ele parece configurado. A tela impede
 *  chegar aqui com zero dias; esta é a guarda para linha gravada por outro caminho. */
export function normalizeSchedule(bruto: Partial<CycleSchedule> | null | undefined): CycleSchedule {
  const dias = Array.isArray(bruto?.weekdays)
    ? [...new Set(bruto.weekdays.filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
    : [];

  const hora = bruto?.hour;
  return {
    enabled: bruto?.enabled === true,
    weekdays: dias.length > 0 ? dias : [...DEFAULT_CYCLE_SCHEDULE.weekdays],
    hour:
      typeof hora === 'number' && Number.isFinite(hora)
        ? clamp(hora, SCHEDULE_HOUR_MIN, SCHEDULE_HOUR_MAX)
        : DEFAULT_CYCLE_SCHEDULE.hour,
    timezone: bruto?.timezone?.trim() || DEFAULT_CYCLE_SCHEDULE.timezone,
  };
}

/** Hoje é um dia em que a contagem é esperada? Usa o dia da semana LOCAL do aparelho — a
 *  tela mostra a situação de quem está olhando; quem decide de verdade é a rotina do banco,
 *  que usa o fuso guardado na configuração. */
export function isScheduledDay(schedule: CycleSchedule, now: Date): boolean {
  return normalizeSchedule(schedule).weekdays.includes(now.getDay());
}

const doisDigitos = (n: number) => String(n).padStart(2, '0');

/** O agendamento em uma linha, para a tela não obrigar ninguém a ler sete caixas marcadas
 *  e deduzir o padrão. */
export function describeSchedule(schedule: CycleSchedule): string {
  const { weekdays, hour } = normalizeSchedule(schedule);
  const horario = `${doisDigitos(hour)}:00`;

  const chave = weekdays.join(',');
  if (chave === '0,1,2,3,4,5,6') return `Todos os dias, a partir das ${horario}`;
  if (chave === '1,2,3,4,5') return `De segunda a sexta, a partir das ${horario}`;
  if (chave === '0,6') return `Fins de semana, a partir das ${horario}`;

  const nomes = weekdays.map(d => WEEKDAY_SHORT[d]);
  const lista =
    nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
  return `${lista}, a partir das ${horario}`;
}

export const DEFAULT_CYCLE_CONFIG: CycleProgramConfig = {
  enabled: false,
  cadenceDays: { A: 30, B: 90, C: 180, sem: 180 },
  dailyCapacity: 30,
  schedule: DEFAULT_CYCLE_SCHEDULE,
};

export const CAPACITY_MIN = 1;
/** Teto de sanidade, não regra de negócio: acima disso o lote deixou de caber num turno e
 *  o programa está sendo usado como inventário geral, que já tem tela própria. */
export const CAPACITY_MAX = 200;
export const CADENCE_MIN = 1;
export const CADENCE_MAX = 3650;

const clamp = (valor: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(valor)));

/** Devolve uma configuração utilizável a partir de qualquer coisa que tenha vindo do banco.
 *
 *  Vale a pena normalizar aqui, e não só no formulário: a linha pode ter sido gravada por
 *  uma versão anterior da tela, por outra pessoa, ou ter uma classe faltando. Uma cadência
 *  zero faria toda a classe aparecer como vencida para sempre, e uma capacidade negativa
 *  esvaziaria o lote sem explicar por quê. */
export function normalizeConfig(bruto: Partial<CycleProgramConfig> | null | undefined): CycleProgramConfig {
  const cadencias = bruto?.cadenceDays;
  const resolver = (bucket: AbcBucket) => {
    const valor = cadencias?.[bucket];
    return typeof valor === 'number' && Number.isFinite(valor)
      ? clamp(valor, CADENCE_MIN, CADENCE_MAX)
      : DEFAULT_CYCLE_CONFIG.cadenceDays[bucket];
  };

  const capacidade = bruto?.dailyCapacity;
  return {
    enabled: bruto?.enabled === true,
    cadenceDays: { A: resolver('A'), B: resolver('B'), C: resolver('C'), sem: resolver('sem') },
    dailyCapacity:
      typeof capacidade === 'number' && Number.isFinite(capacidade)
        ? clamp(capacidade, CAPACITY_MIN, CAPACITY_MAX)
        : DEFAULT_CYCLE_CONFIG.dailyCapacity,
    schedule: normalizeSchedule(bruto?.schedule),
  };
}

/** De onde o SKU entrou no lote do dia. */
export type BatchOrigin = 'vencido' | 'nunca';

export const ORIGIN_LABEL: Record<BatchOrigin, string> = {
  vencido: 'Cadência vencida',
  nunca: 'Nunca contado',
};

export interface BatchEntry {
  productId: string;
  sku: string;
  name: string;
  location: string | null;
  value: number;
  bucket: AbcBucket;
  cadenceDays: number;
  origin: BatchOrigin;
  /** Dias desde a última contagem. `null` para quem nunca foi contado. */
  dias: number | null;
  /** Dias ÷ cadência da classe. `Infinity` para nunca contado. É o que ordena os vencidos:
   *  um A em 1,5× a cadência passa na frente de um C em 0,6×, mesmo o C estando parado há
   *  mais dias em números absolutos. */
  ratio: number;
}

export interface DailyBatch {
  entries: BatchEntry[];
  capacity: number;
  /** Quantos existem ao todo em cada faixa — não quantos entraram. A diferença entre os
   *  dois é o tamanho da fila, e é o que diz se a capacidade está adequada. */
  dueTotal: number;
  backlogTotal: number;
  dueTaken: number;
  backlogTaken: number;
  /** Dias para zerar os nunca contados no ritmo de hoje.
   *
   *  `null` quando os vencidos já consomem toda a capacidade: nesse caso o backlog não anda
   *  e nenhum prazo seria honesto. Zero quando não há backlog. É uma projeção a ritmo
   *  constante, não uma promessa: cada contagem feita hoje volta a vencer lá na frente. */
  backlogDaysToClear: number | null;
}

/** A entrada do lote mais a posição original no catálogo, usada só como último critério de
 *  desempate. Fica ao lado da entrada, e não dentro dela, para não vazar um campo interno
 *  para quem consome `DailyBatch`. */
interface Candidato {
  entry: BatchEntry;
  ordem: number;
}

/** Monta o lote do dia. Determinístico: mesmas entradas, mesmo lote — o que permite abrir a
 *  tela de manhã e de novo à tarde sem a lista trocar debaixo de quem está contando. */
export function planDailyBatch(
  items: CoverageItem[],
  config: CycleProgramConfig,
  now: Date
): DailyBatch {
  const { cadenceDays, dailyCapacity } = normalizeConfig(config);

  const vencidos: Candidato[] = [];
  const nunca: Candidato[] = [];

  items.forEach((item, indice) => {
    const bucket = bucketOf(item.abc);
    const cadencia = cadenceDays[bucket];
    const dias = daysSince(item.lastCountedAt, now);

    const base = {
      productId: item.productId,
      sku: item.sku,
      name: item.name,
      location: item.location,
      value: item.value,
      bucket,
      cadenceDays: cadencia,
      dias,
    };

    if (dias === null) {
      nunca.push({ entry: { ...base, origin: 'nunca', ratio: Infinity }, ordem: indice });
      return;
    }
    // Estritamente maior: no dia exato da cadência o item ainda está em dia. Usar >= faria
    // o SKU vencer um dia antes do prazo que a própria tela anuncia.
    if (dias > cadencia) {
      vencidos.push({ entry: { ...base, origin: 'vencido', ratio: dias / cadencia }, ordem: indice });
    }
  });

  // Mais estourado primeiro; empate decide por valor parado, e depois por SKU para o lote
  // não depender da ordem em que o banco devolveu as linhas.
  vencidos.sort((a, b) =>
    b.entry.ratio - a.entry.ratio ||
    b.entry.value - a.entry.value ||
    a.entry.sku.localeCompare(b.entry.sku) ||
    a.ordem - b.ordem
  );
  // Nunca contados não têm atraso relativo para comparar — todos são Infinity. Sobra o
  // valor: começar pelo dinheiro parado é o que faz o backlog pagar por si mesmo.
  nunca.sort((a, b) =>
    b.entry.value - a.entry.value || a.entry.sku.localeCompare(b.entry.sku) || a.ordem - b.ordem
  );

  const capacity = dailyCapacity;
  const daFaixaVencida = vencidos.slice(0, capacity);
  const sobra = Math.max(0, capacity - daFaixaVencida.length);
  const daFaixaBacklog = nunca.slice(0, sobra);

  const entries = [...daFaixaVencida, ...daFaixaBacklog].map(c => c.entry);

  const backlogDaysToClear =
    nunca.length === 0 ? 0 : sobra === 0 ? null : Math.ceil(nunca.length / sobra);

  return {
    entries,
    capacity,
    dueTotal: vencidos.length,
    backlogTotal: nunca.length,
    dueTaken: daFaixaVencida.length,
    backlogTaken: daFaixaBacklog.length,
    backlogDaysToClear,
  };
}

export interface ProgramStatus {
  total: number;
  emDia: number;
  vencidos: number;
  nunca: number;
}

/** Retrato do catálogo sob a cadência configurada. Separado de `planDailyBatch` porque
 *  responde a outra pergunta: o lote é o trabalho de hoje, isto é a saúde do programa. */
export function programStatus(
  items: CoverageItem[],
  config: CycleProgramConfig,
  now: Date
): ProgramStatus {
  const { cadenceDays } = normalizeConfig(config);
  const status: ProgramStatus = { total: items.length, emDia: 0, vencidos: 0, nunca: 0 };

  for (const item of items) {
    const dias = daysSince(item.lastCountedAt, now);
    if (dias === null) status.nunca += 1;
    else if (dias > cadenceDays[bucketOf(item.abc)]) status.vencidos += 1;
    else status.emDia += 1;
  }

  return status;
}

// ── Materialização: do lote para uma contagem física ─────────────────────────
//
// O lote vira uma sessão de contagem comum, pelo mesmo caminho que a Contagem Física já
// usa — nada de tabela nova nem de tipo de sessão paralelo. A sessão guarda a faixa
// contada em `street_from`/`street_to`, que ali são texto livre, e é isso que marca a
// sessão como vinda da ciclagem: a "faixa" de um lote de ciclagem não é um trecho do
// galpão, é o dia. Essa marca também é o que impede gerar o mesmo lote duas vezes.

export const CYCLE_SESSION_MARKER = 'Ciclagem';

/** Rótulo do dia, montado das partes locais da data em vez de `toLocaleDateString`.
 *
 *  É comparado por igualdade exata para achar o lote de hoje, então precisa ser estável:
 *  o formato de `toLocaleDateString` muda com o locale do navegador, e dois aparelhos da
 *  mesma equipe gerariam marcas diferentes para o mesmo dia. O fuso é o local de propósito
 *  — "hoje" para quem está no galpão é o dia do relógio dele, não UTC. */
export function cycleSessionDayLabel(now: Date): string {
  const dia = String(now.getDate()).padStart(2, '0');
  const mes = String(now.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${now.getFullYear()}`;
}

/** A "faixa" da sessão gerada. Na lista de contagens aparece como `Ciclagem → 03/11/2026`. */
export function cycleSessionRange(now: Date): { from: string; to: string } {
  return { from: CYCLE_SESSION_MARKER, to: cycleSessionDayLabel(now) };
}

/** Observação da sessão: a composição do lote, em texto, para quem abrir a contagem semanas
 *  depois saber por que aqueles SKUs estavam ali. A tela de ciclagem recalcula o lote a cada
 *  carga; a sessão é o único lugar onde a composição do dia fica registrada. */
export function cycleSessionObservation(batch: DailyBatch, now: Date): string {
  const partes = [
    `Lote gerado pelo programa de ciclagem em ${cycleSessionDayLabel(now)}.`,
    `${batch.entries.length} ${plural(batch.entries.length, 'SKU', 'SKUs')}: ${batch.dueTaken} por cadência vencida, ${batch.backlogTaken} nunca ${plural(batch.backlogTaken, 'contado', 'contados')}.`,
  ];
  if (batch.dueTotal > batch.dueTaken) {
    partes.push(`${batch.dueTotal - batch.dueTaken} com cadência vencida não couberam na capacidade do dia.`);
  }
  return partes.join(' ');
}

/** Os produtos do lote, na ordem em que o lote os priorizou.
 *
 *  A ordem importa: `pc_create_session` insere os itens a partir da tabela de produtos, então
 *  ela não sobrevive até a tela de contagem — mas o que entra na lista sim, e enviar o lote
 *  inteiro de uma vez é o que garante que o recorte contado é exatamente o recorte mostrado. */
export function cycleSessionProductIds(batch: DailyBatch): string[] {
  return batch.entries.map(e => e.productId);
}
