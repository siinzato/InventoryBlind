import { describe, expect, it } from 'vitest';
import { normalizeCnpj, isValidCnpjChecksum, formatCnpj, maskCnpjInput } from '../cnpjUtils';

describe('normalizeCnpj', () => {
  it('remove tudo que não é dígito', () => {
    expect(normalizeCnpj('11.444.777/0001-61')).toBe('11444777000161');
  });

  it('trunca em 14 dígitos', () => {
    expect(normalizeCnpj('112223330001819999')).toBe('11222333000181');
  });
});

describe('isValidCnpjChecksum', () => {
  it('aceita um CNPJ válido conhecido', () => {
    expect(isValidCnpjChecksum('11444777000161')).toBe(true);
    expect(isValidCnpjChecksum('11.444.777/0001-61')).toBe(true);
  });

  it('aceita o CNPJ autorizado do workspace AZ', () => {
    expect(isValidCnpjChecksum('10256416000129')).toBe(true);
    expect(isValidCnpjChecksum('10.256.416/0001-29')).toBe(true);
  });

  it('rejeita dígito verificador incorreto', () => {
    expect(isValidCnpjChecksum('11222333000180')).toBe(false);
  });

  it('rejeita sequência de dígito único repetido', () => {
    expect(isValidCnpjChecksum('11111111111111')).toBe(false);
    expect(isValidCnpjChecksum('00000000000000')).toBe(false);
  });

  it('rejeita tamanho incorreto', () => {
    expect(isValidCnpjChecksum('123')).toBe(false);
    expect(isValidCnpjChecksum('')).toBe(false);
  });
});

describe('formatCnpj', () => {
  it('formata 14 dígitos com máscara padrão', () => {
    expect(formatCnpj('10256416000129')).toBe('10.256.416/0001-29');
  });

  it('devolve os dígitos crus quando incompleto', () => {
    expect(formatCnpj('123')).toBe('123');
  });
});

describe('maskCnpjInput', () => {
  it('aplica a máscara progressivamente conforme o usuário digita', () => {
    expect(maskCnpjInput('1')).toBe('1');
    expect(maskCnpjInput('102564')).toBe('10.256.4');
    expect(maskCnpjInput('102564160001')).toBe('10.256.416/0001');
    expect(maskCnpjInput('10256416000129')).toBe('10.256.416/0001-29');
  });
});
