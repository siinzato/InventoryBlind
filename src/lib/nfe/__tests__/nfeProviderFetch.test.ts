// Prova que a Nova Devolução (e a Conferência por NF-e) chamam de fato a mesma
// consulta por chave já existente (Edge Function nfe-fetch-by-key), sem
// duplicar a integração com o provedor. supabase.ts lança se as env vars
// VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY faltarem, então o client é mockado
// (vi.mock, já incluso no vitest — nenhuma dependência nova) em vez de
// importado de verdade; nenhuma chamada de rede real acontece neste teste.

import { describe, expect, it, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
vi.mock('../../supabase', () => ({
  supabase: { functions: { invoke } },
}));

const VALID_KEY = '1'.repeat(44);

describe('fetchNfeXmlByKey — consulta por chave reaproveitada da Conferência por NF-e', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('chama a mesma Edge Function (nfe-fetch-by-key) com a chave normalizada', async () => {
    invoke.mockResolvedValueOnce({ data: { outcome: 'ok', xml: '<xml>nota</xml>' }, error: null });
    const { fetchNfeXmlByKey } = await import('../nfeProviderFetch');

    const xml = await fetchNfeXmlByKey(VALID_KEY);

    expect(invoke).toHaveBeenCalledWith('nfe-fetch-by-key', { body: { invoiceKey: VALID_KEY } });
    expect(xml).toBe('<xml>nota</xml>');
  });

  it('reaproveita o XML já baixado quando a chave já existe em nfe_invoices (Conferência), sem nova chamada ao provedor', async () => {
    invoke.mockResolvedValueOnce({
      data: { outcome: 'already_imported', invoice: { id: 'inv-1', raw_xml: '<xml>já importada</xml>' } },
      error: null,
    });
    const { fetchNfeXmlByKey } = await import('../nfeProviderFetch');

    const xml = await fetchNfeXmlByKey(VALID_KEY);

    expect(xml).toBe('<xml>já importada</xml>');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('rejeita antes de chamar a função quando a chave não tem 44 dígitos', async () => {
    const { fetchNfeXmlByKey } = await import('../nfeProviderFetch');

    await expect(fetchNfeXmlByKey('123')).rejects.toThrow('Chave de acesso inválida');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('fetchAndImportNfeByKey (Conferência por NF-e) ainda trata "já importada" como sempre tratou — comportamento existente preservado pelo refactor', async () => {
    invoke.mockResolvedValueOnce({
      data: { outcome: 'already_imported', invoice: { id: 'inv-1', raw_xml: '<xml>já importada</xml>' } },
      error: null,
    });
    const { fetchAndImportNfeByKey, NfeFetchByKeyError } = await import('../nfeProviderFetch');

    await expect(fetchAndImportNfeByKey(VALID_KEY)).rejects.toBeInstanceOf(NfeFetchByKeyError);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
