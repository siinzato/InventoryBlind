import { describe, expect, it } from 'vitest';
import { parseDecimalInput, validateDecimalInput, validatePoItemFields } from '../poDecimalUtils';

describe('validateDecimalInput', () => {
  it('aceita vírgula e ponto decimal', () => {
    expect(validateDecimalInput('10,5', 'a quantidade', { required: true })).toBeNull();
    expect(validateDecimalInput('10.5', 'a quantidade', { required: true })).toBeNull();
  });

  it('rejeita vazio quando obrigatório', () => {
    expect(validateDecimalInput('', 'a quantidade', { required: true })).toBe('Informe a quantidade.');
  });

  it('permite vazio quando não obrigatório', () => {
    expect(validateDecimalInput('', 'o preço unitário', { required: false })).toBeNull();
  });

  it('rejeita não-número', () => {
    expect(validateDecimalInput('abc', 'a quantidade')).toContain('número válido');
  });

  it('rejeita negativo', () => {
    expect(validateDecimalInput('-5', 'a quantidade')).toContain('não pode ser negativo');
  });

  it('rejeita zero quando allowZero é false', () => {
    expect(validateDecimalInput('0', 'a quantidade', { allowZero: false })).toContain('maior que zero');
  });
});

describe('parseDecimalInput', () => {
  it('nunca altera silenciosamente o valor digitado — só converte', () => {
    expect(parseDecimalInput('10,5')).toBe(10.5);
    expect(parseDecimalInput('  7 ')).toBe(7);
  });

  it('retorna null para vazio ou inválido', () => {
    expect(parseDecimalInput('')).toBeNull();
    expect(parseDecimalInput('abc')).toBeNull();
  });
});

describe('validatePoItemFields', () => {
  it('exige descrição e quantidade', () => {
    const errors = validatePoItemFields({ description: '', quantity: '' });
    expect(errors.description).toBeTruthy();
    expect(errors.quantity).toBeTruthy();
  });

  it('aceita item válido sem preço', () => {
    const errors = validatePoItemFields({ description: 'Produto X', quantity: '10' });
    expect(errors).toEqual({});
  });

  it('valida preço unitário só quando informado', () => {
    const errors = validatePoItemFields({ description: 'Produto X', quantity: '10', unitPrice: 'abc' });
    expect(errors.unitPrice).toBeTruthy();
  });
});
