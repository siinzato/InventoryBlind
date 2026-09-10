import { describe, expect, it } from 'vitest';
import { resolveNfeCounterparty } from '../nfeCounterparty';

const base = {
  supplierName: 'Fornecedor Alpha',
  supplierCnpj: '12345678000190',
  destName: 'Cliente Devolvendo LTDA',
  destCnpj: '98765432000199',
  destCpf: null,
};

describe('resolveNfeCounterparty', () => {
  it('quando o workspace é o destinatário, a contraparte é o emitente', () => {
    const r = resolveNfeCounterparty(base, ['98765432000199']);
    expect(r.role).toBe('emit');
    expect(r.name).toBe('Fornecedor Alpha');
    expect(r.cnpj).toBe('12345678000190');
  });

  it('quando o workspace é o emitente, a contraparte é o destinatário', () => {
    const r = resolveNfeCounterparty(base, ['12345678000190']);
    expect(r.role).toBe('dest');
    expect(r.name).toBe('Cliente Devolvendo LTDA');
    expect(r.cnpj).toBe('98765432000199');
  });

  it('destinatário pessoa física: CPF é devolvido em vez de CNPJ', () => {
    const withCpf = { ...base, destCnpj: null, destCpf: '11122233344' };
    const r = resolveNfeCounterparty(withCpf, ['12345678000190']);
    expect(r.role).toBe('dest');
    expect(r.cnpj).toBeNull();
    expect(r.cpf).toBe('11122233344');
  });

  it('nenhum CNPJ do workspace cadastrado: não afirma, mantém o emitente como melhor palpite sem confirmar', () => {
    const r = resolveNfeCounterparty(base, []);
    expect(r.role).toBe('unknown');
    expect(r.name).toBe('Fornecedor Alpha');
  });

  it('nenhum CNPJ do workspace bate com emitente ou destinatário: unknown, sem inventar', () => {
    const r = resolveNfeCounterparty(base, ['00000000000000']);
    expect(r.role).toBe('unknown');
  });

  it('CNPJ com máscara é normalizado antes da comparação', () => {
    const r = resolveNfeCounterparty(base, ['98.765.432/0001-99']);
    expect(r.role).toBe('emit');
  });

  it('nunca compara por nome/razão social — só por CNPJ', () => {
    const sameNameDifferentCnpj = { ...base, destCnpj: '11111111000191' };
    const r = resolveNfeCounterparty(sameNameDifferentCnpj, ['98765432000199']);
    // O CNPJ cadastrado não bate com nenhum dos dois lados do documento — unknown,
    // mesmo que o nome do destinatário pareça familiar.
    expect(r.role).toBe('unknown');
  });
});
