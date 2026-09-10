import { EncryptedPDFError } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { classifyPdfError } from '../pdfErrorClassification';

describe('classifyPdfError', () => {
  it('reconhece PDF protegido por senha (pdf-lib)', () => {
    expect(classifyPdfError(new EncryptedPDFError())).toBe('password-protected');
  });

  it('reconhece PDF protegido por senha (pdfjs, por nome)', () => {
    const err = new Error('bad password');
    err.name = 'PasswordException';
    expect(classifyPdfError(err)).toBe('password-protected');
  });

  it('reconhece PDF corrompido/inválido (pdfjs, por nome)', () => {
    const err = new Error('invalid pdf structure');
    err.name = 'InvalidPDFException';
    expect(classifyPdfError(err)).toBe('corrupted');
  });

  it('erro genérico de Error vira "corrupted" (é o caso mais comum ao tentar abrir lixo)', () => {
    expect(classifyPdfError(new Error('unexpected token'))).toBe('corrupted');
  });

  it('valor que não é Error vira "unknown"', () => {
    expect(classifyPdfError('string qualquer')).toBe('unknown');
    expect(classifyPdfError(null)).toBe('unknown');
  });
});
