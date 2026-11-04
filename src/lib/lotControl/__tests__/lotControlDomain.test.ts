import { describe, expect, it } from 'vitest';
import {
  ALERT_DAYS_MAX, DEFAULT_LOT_CONTROL, buildExpiryLines, daysUntil, describeDays,
  expiryStatus, normalizeLotControl, parseLocalDate, summarizeExpiry,
  type ExpiryEntry,
} from '../lotControlDomain';

const HOJE = new Date(2026, 10, 4, 14, 30); // 4 de novembro de 2026, horário local

let seq = 0;
function entrada(over: Partial<ExpiryEntry> = {}): ExpiryEntry {
  seq += 1;
  return {
    id: `e${seq}`,
    productId: `p${seq}`,
    sku: `SKU${seq}`,
    productName: `Produto ${seq}`,
    binCode: 'PP-A01-N1',
    lotNumber: null,
    expiryDate: '2026-12-01',
    units: 10,
    invoiceNumber: '123',
    receivedAt: '2026-11-01T10:00:00Z',
    ...over,
  };
}

describe('a chave nasce desligada', () => {
  it('o padrão é tudo desligado', () => {
    expect(DEFAULT_LOT_CONTROL).toEqual({ lotEnabled: false, expiryEnabled: false, expiryAlertDays: 30 });
  });

  // Qualquer coisa que não seja `true` é desligado: num dado corrompido ou vindo de
  // versão anterior, a escolha segura é não ligar um recurso que a empresa não pediu.
  it('só `true` liga', () => {
    expect(normalizeLotControl({ lotEnabled: undefined }).lotEnabled).toBe(false);
    expect(normalizeLotControl(null).expiryEnabled).toBe(false);
    expect(normalizeLotControl({ lotEnabled: true }).lotEnabled).toBe(true);
  });

  it('os dias de aviso são presos aos limites', () => {
    expect(normalizeLotControl({ expiryAlertDays: 0 }).expiryAlertDays).toBe(1);
    expect(normalizeLotControl({ expiryAlertDays: 9999 }).expiryAlertDays).toBe(ALERT_DAYS_MAX);
    expect(normalizeLotControl({ expiryAlertDays: Number.NaN }).expiryAlertDays).toBe(30);
  });

  it('as duas chaves são independentes', () => {
    const so_lote = normalizeLotControl({ lotEnabled: true, expiryEnabled: false });
    expect(so_lote).toMatchObject({ lotEnabled: true, expiryEnabled: false });
  });
});

describe('data de validade é data civil, não instante', () => {
  // `new Date('2026-11-04')` é lido como UTC e, num fuso a oeste, volta como dia 3.
  // Validade se compara com o calendário da parede.
  it('lê YYYY-MM-DD como data local', () => {
    const d = parseLocalDate('2026-11-04');
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(10);
    expect(d?.getDate()).toBe(4);
  });

  it('texto ilegível não vira data', () => {
    expect(parseLocalDate('qualquer coisa')).toBeNull();
    expect(daysUntil('qualquer coisa', HOJE)).toBeNull();
  });

  // A hora de HOJE não pode influenciar: às 14h30 ou às 23h59, falta o mesmo tanto.
  it('ignora a hora do dia na conta', () => {
    const cedo = new Date(2026, 10, 4, 0, 1);
    const tarde = new Date(2026, 10, 4, 23, 59);
    expect(daysUntil('2026-11-10', cedo)).toBe(daysUntil('2026-11-10', tarde));
  });

  it('conta dias inteiros, inclusive negativos', () => {
    expect(daysUntil('2026-11-04', HOJE)).toBe(0);
    expect(daysUntil('2026-11-05', HOJE)).toBe(1);
    expect(daysUntil('2026-11-01', HOJE)).toBe(-3);
  });

  // Atravessa a virada do mês e do ano sem aritmética de calendário manual.
  it('atravessa mês e ano', () => {
    expect(daysUntil('2026-12-04', HOJE)).toBe(30);
    expect(daysUntil('2027-01-04', HOJE)).toBe(61);
  });
});

describe('faixas de vencimento', () => {
  // Vencer HOJE é crítico, não vencido: o produto ainda pode sair. É a diferença
  // entre pedir pressa e mandar descartar.
  it('o que vence hoje ainda é crítico', () => {
    expect(expiryStatus('2026-11-04', HOJE, 30)).toBe('critico');
  });

  it('ontem já venceu', () => {
    expect(expiryStatus('2026-11-03', HOJE, 30)).toBe('vencido');
  });

  it('o limite de aviso é inclusivo', () => {
    expect(expiryStatus('2026-12-04', HOJE, 30)).toBe('critico');  // exatamente 30
    expect(expiryStatus('2026-12-05', HOJE, 30)).toBe('ok');        // 31
  });

  it('a antecedência configurada manda', () => {
    expect(expiryStatus('2026-11-20', HOJE, 7)).toBe('ok');
    expect(expiryStatus('2026-11-20', HOJE, 60)).toBe('critico');
  });
});

describe('a lista', () => {
  // Vencido no topo mesmo sendo "passado": é o único que exige decisão hoje, e
  // enterrá-lo embaixo do que vence em 20 dias é como ele fica esquecido.
  it('ordena do mais urgente para o mais distante', () => {
    const linhas = buildExpiryLines([
      entrada({ id: 'futuro', expiryDate: '2026-12-20' }),
      entrada({ id: 'vencido', expiryDate: '2026-10-01' }),
      entrada({ id: 'breve', expiryDate: '2026-11-10' }),
    ], HOJE, 30);
    expect(linhas.map(l => l.id)).toEqual(['vencido', 'breve', 'futuro']);
  });

  it('empate de data desempata por SKU, de forma estável', () => {
    const linhas = buildExpiryLines([
      entrada({ id: 'b', sku: 'ZZZ', expiryDate: '2026-11-10' }),
      entrada({ id: 'a', sku: 'AAA', expiryDate: '2026-11-10' }),
    ], HOJE, 30);
    expect(linhas.map(l => l.sku)).toEqual(['AAA', 'ZZZ']);
  });

  it('soma as unidades em risco, sem contar o que está no prazo', () => {
    const linhas = buildExpiryLines([
      entrada({ expiryDate: '2026-10-01', units: 5 }),   // vencido
      entrada({ expiryDate: '2026-11-10', units: 7 }),   // crítico
      entrada({ expiryDate: '2027-06-01', units: 100 }), // no prazo
    ], HOJE, 30);
    expect(summarizeExpiry(linhas)).toEqual({
      vencidos: 1, criticos: 1, noPrazo: 1, unidadesEmRisco: 12,
    });
  });
});

describe('como o prazo é dito', () => {
  it('fala em português de quem lê a lista', () => {
    expect(describeDays(-3)).toBe('venceu há 3 dia(s)');
    expect(describeDays(0)).toBe('vence hoje');
    expect(describeDays(1)).toBe('vence amanhã');
    expect(describeDays(12)).toBe('em 12 dia(s)');
    expect(describeDays(null)).toBe('—');
  });
});
