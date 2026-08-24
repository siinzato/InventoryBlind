import { describe, expect, it } from 'vitest';
import { buildOutputFilename, dedupeFilenames, extensionOf, sanitizeFileBaseName, stripExtension } from '../filenames';

describe('sanitizeFileBaseName', () => {
  it('remove caracteres inválidos de nome de arquivo', () => {
    expect(sanitizeFileBaseName('nota:fiscal*teste?.pdf')).toBe('notafiscalteste.pdf');
  });

  it('preserva espaços e hífens (válidos em nome de arquivo)', () => {
    expect(sanitizeFileBaseName('Relatório - Agosto 2026')).toBe('Relatório - Agosto 2026');
  });

  it('nunca retorna vazio', () => {
    expect(sanitizeFileBaseName('///???')).toBe('documento');
  });

  it('colapsa espaços repetidos', () => {
    expect(sanitizeFileBaseName('a    b')).toBe('a b');
  });
});

describe('stripExtension / extensionOf', () => {
  it('separa nome e extensão corretamente', () => {
    expect(stripExtension('arquivo.pdf')).toBe('arquivo');
    expect(extensionOf('arquivo.pdf')).toBe('pdf');
  });

  it('nome sem extensão não quebra', () => {
    expect(stripExtension('arquivo')).toBe('arquivo');
    expect(extensionOf('arquivo')).toBe('');
  });
});

describe('buildOutputFilename', () => {
  it('monta nome com prefixo, sufixo e índice', () => {
    const name = buildOutputFilename('nota.pdf', { prefix: 'lote', suffix: 'otimizado', index: 2, ext: 'pdf' });
    expect(name).toBe('lote-nota-otimizado-002.pdf');
  });

  it('sem prefixo/sufixo/índice, só troca a extensão', () => {
    expect(buildOutputFilename('nota.pdf', { ext: 'png' })).toBe('nota.png');
  });
});

describe('dedupeFilenames', () => {
  it('sufixa duplicatas para não colidir num ZIP', () => {
    expect(dedupeFilenames(['nota.pdf', 'nota.pdf', 'nota.pdf'])).toEqual([
      'nota.pdf', 'nota (2).pdf', 'nota (3).pdf',
    ]);
  });

  it('não mexe em nomes já únicos', () => {
    expect(dedupeFilenames(['a.pdf', 'b.pdf'])).toEqual(['a.pdf', 'b.pdf']);
  });
});
