import { describe, expect, it } from 'vitest';
import { findPossibleDuplicatePos } from '../poNumberUtils';

describe('findPossibleDuplicatePos', () => {
  const existing = [
    { id: 'a', poNumber: 'OC-100', supplierName: 'Fornecedor X' },
    { id: 'b', poNumber: 'OC-200', supplierName: 'Fornecedor Y' },
  ];

  it('encontra duplicidade por número + fornecedor, ignorando maiúsculas/espaços', () => {
    const found = findPossibleDuplicatePos(existing, ' oc-100 ', 'FORNECEDOR X');
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe('a');
  });

  it('não considera duplicidade quando o fornecedor é diferente', () => {
    const found = findPossibleDuplicatePos(existing, 'OC-100', 'Outro Fornecedor');
    expect(found).toHaveLength(0);
  });

  it('exclui a própria OC ao editar (excludeId)', () => {
    const found = findPossibleDuplicatePos(existing, 'OC-100', 'Fornecedor X', 'a');
    expect(found).toHaveLength(0);
  });

  it('nunca bloqueia — só informa (retorna lista, não lança)', () => {
    expect(() => findPossibleDuplicatePos(existing, 'OC-100', 'Fornecedor X')).not.toThrow();
  });
});
