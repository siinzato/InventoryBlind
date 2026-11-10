import { plural } from '../../lib/formatPtBr';
// Lote e validade — as regras, sem nenhum acesso a dados.
//
// ── A chave é o recurso ─────────────────────────────────────────────────────
// Rastrear lote é obrigação para quem trabalha com perecível e peso morto para
// quem não trabalha. Por isso as duas opções nascem DESLIGADAS e, desligadas, não
// deixam resíduo: nenhum campo no recebimento, nenhuma aba no menu, nenhum aviso.
// A chave não esconde a função — ela a mantém ausente.
//
// São duas chaves porque são dois problemas. Lote responde "onde foi parar o que
// saiu daquela remessa" num recall; validade responde "o que vence primeiro". Uma
// distribuidora pode precisar de lote sem precisar de validade, e juntar as duas
// obrigaria a ligar o que não se usa.
//
// Módulo puro: sem I/O, sem relógio. `hoje` sempre entra por parâmetro.

export interface LotControlSettings {
  lotEnabled: boolean;
  expiryEnabled: boolean;
  /** Com quantos dias de antecedência um vencimento vira aviso. */
  expiryAlertDays: number;
}

export const DEFAULT_LOT_CONTROL: LotControlSettings = {
  lotEnabled: false,
  expiryEnabled: false,
  expiryAlertDays: 30,
};

export const ALERT_DAYS_MIN = 1;
export const ALERT_DAYS_MAX = 365;

export function normalizeLotControl(
  bruto: Partial<LotControlSettings> | null | undefined
): LotControlSettings {
  const dias = bruto?.expiryAlertDays;
  return {
    lotEnabled: bruto?.lotEnabled === true,
    expiryEnabled: bruto?.expiryEnabled === true,
    expiryAlertDays:
      typeof dias === 'number' && Number.isFinite(dias)
        ? Math.min(ALERT_DAYS_MAX, Math.max(ALERT_DAYS_MIN, Math.round(dias)))
        : DEFAULT_LOT_CONTROL.expiryAlertDays,
  };
}

/** Situação de um vencimento diante da data de hoje. */
export type ExpiryStatus = 'vencido' | 'critico' | 'ok';

export const EXPIRY_STATUS_LABEL: Record<ExpiryStatus, string> = {
  vencido: 'Vencido',
  critico: 'Vence em breve',
  ok: 'No prazo',
};

/** Converte `YYYY-MM-DD` numa data LOCAL à meia-noite.
 *
 *  `new Date('2026-11-04')` é interpretado como UTC e, num fuso a oeste, volta como
 *  3 de novembro às 21h — um dia a menos. Validade é data civil, não instante: quem
 *  está no galpão compara com o calendário da parede. */
export function parseLocalDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

const MS_DIA = 86_400_000;

/** Dias inteiros até a validade. Negativo quando já venceu, 0 quando vence hoje.
 *  `null` quando a data não é legível. */
export function daysUntil(expiry: string, hoje: Date): number | null {
  const alvo = parseLocalDate(expiry);
  if (!alvo) return null;
  const base = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.round((alvo.getTime() - base.getTime()) / MS_DIA);
}

/** Vencer HOJE conta como crítico, não como vencido: o produto ainda pode sair.
 *  É a diferença entre pedir pressa e mandar descartar. */
export function expiryStatus(expiry: string, hoje: Date, alertDays: number): ExpiryStatus {
  const dias = daysUntil(expiry, hoje);
  if (dias === null) return 'ok';
  if (dias < 0) return 'vencido';
  if (dias <= alertDays) return 'critico';
  return 'ok';
}

export interface ExpiryEntry {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  binCode: string;
  lotNumber: string | null;
  expiryDate: string;
  units: number;
  /** De qual recebimento veio. */
  invoiceNumber: string | null;
  receivedAt: string;
}

export interface ExpiryLine extends ExpiryEntry {
  status: ExpiryStatus;
  /** Negativo = dias desde o vencimento. */
  days: number | null;
}

/** Classifica e ordena: o que já venceu primeiro, depois o que vence antes.
 *
 *  O vencido vem no topo mesmo sendo "passado" porque é o único item que exige
 *  decisão imediata — e enterrá-lo embaixo do que vence daqui a 20 dias é como ele
 *  fica esquecido no endereço. */
export function buildExpiryLines(
  entries: ExpiryEntry[],
  hoje: Date,
  alertDays: number
): ExpiryLine[] {
  return entries
    .map(e => ({ ...e, status: expiryStatus(e.expiryDate, hoje, alertDays), days: daysUntil(e.expiryDate, hoje) }))
    .sort((a, b) =>
      (a.days ?? Number.MAX_SAFE_INTEGER) - (b.days ?? Number.MAX_SAFE_INTEGER) ||
      a.sku.localeCompare(b.sku)
    );
}

export interface ExpirySummary {
  vencidos: number;
  criticos: number;
  noPrazo: number;
  /** Unidades em risco: vencidas ou perto de vencer. É o número que mede o
   *  prejuízo iminente, e é por isso que soma as duas faixas. */
  unidadesEmRisco: number;
}

export function summarizeExpiry(lines: ExpiryLine[]): ExpirySummary {
  const conta = (s: ExpiryStatus) => lines.filter(l => l.status === s).length;
  return {
    vencidos: conta('vencido'),
    criticos: conta('critico'),
    noPrazo: conta('ok'),
    unidadesEmRisco: lines
      .filter(l => l.status !== 'ok')
      .reduce((soma, l) => soma + l.units, 0),
  };
}

/** Texto curto do prazo, do ponto de vista de quem lê a lista. */
export function describeDays(days: number | null): string {
  if (days === null) return '—';
  if (days < 0) return `venceu há ${Math.abs(days)} ${plural(Math.abs(days), 'dia', 'dias')}`;
  if (days === 0) return 'vence hoje';
  if (days === 1) return 'vence amanhã';
  return `em ${days} ${plural(days, 'dia', 'dias')}`;
}
