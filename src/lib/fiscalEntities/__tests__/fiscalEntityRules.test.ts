import { describe, expect, it } from 'vitest';
import {
  canArchiveFiscalEntity,
  shouldAutoDefaultOnCreate,
  shouldAutoDefaultOnRestore,
} from '../fiscalEntityRules';

describe('canArchiveFiscalEntity', () => {
  it('permite arquivar uma empresa ativa que não é a padrão', () => {
    expect(canArchiveFiscalEntity({ status: 'active', isDefault: false })).toBe(true);
  });

  it('bloqueia arquivar a empresa padrão (cobre também "é a única ativa")', () => {
    expect(canArchiveFiscalEntity({ status: 'active', isDefault: true })).toBe(false);
  });

  it('bloqueia arquivar uma empresa já arquivada', () => {
    expect(canArchiveFiscalEntity({ status: 'archived', isDefault: false })).toBe(false);
  });
});

describe('shouldAutoDefaultOnCreate', () => {
  it('define como padrão quando é a primeira empresa ativa', () => {
    expect(shouldAutoDefaultOnCreate(0)).toBe(true);
  });

  it('não força padrão quando já existem outras empresas ativas', () => {
    expect(shouldAutoDefaultOnCreate(1)).toBe(false);
    expect(shouldAutoDefaultOnCreate(3)).toBe(false);
  });
});

describe('shouldAutoDefaultOnRestore', () => {
  it('promove a padrão quando não sobra nenhuma outra empresa ativa', () => {
    expect(shouldAutoDefaultOnRestore(0)).toBe(true);
  });

  it('não promove quando já existe outra empresa ativa', () => {
    expect(shouldAutoDefaultOnRestore(1)).toBe(false);
  });
});
