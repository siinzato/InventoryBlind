import { describe, expect, it } from 'vitest';
import { resolveOriginChannel, describeOriginChannel } from '../originChannelResolver';
import type { IntegrationConnection } from '../../integrations/types';

function connection(overrides: Partial<IntegrationConnection>): IntegrationConnection {
  return {
    id: 'conn-1',
    companyId: 'company-1',
    providerKey: 'mercado_livre',
    displayName: 'Mercado Livre / Azbuy',
    externalAccountId: null,
    status: 'pending',
    fiscalEntityId: 'fiscal-1',
    configuration: {},
    syncDirection: 'inbound',
    stockSourceOfTruth: false,
    autoSyncEnabled: false,
    syncIntervalMinutes: null,
    syncCursor: null,
    credentialsSetAt: null,
    credentialHint: null,
    lastSyncAt: null,
    lastSuccessfulSyncAt: null,
    lastError: null,
    lastErrorAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('resolveOriginChannel', () => {
  it('resolve "mapeada" quando exatamente uma conexão tem o mesmo idCadIntTran (ignorando maiúsculas/espaços)', () => {
    const azbuy = connection({ id: 'conn-azbuy', displayName: 'Mercado Livre / Azbuy', externalAccountId: 'GOCASE123' });
    const filial = connection({ id: 'conn-filial', displayName: 'Mercado Livre / AZ Filial', externalAccountId: 'FILIAL456' });

    const result = resolveOriginChannel(
      { intermediaryCnpj: '03007331000141', intermediaryIdCadIntTran: '  gocase123 ' },
      [azbuy, filial],
    );

    expect(result.source).toBe('mapeada');
    expect(result.connection?.id).toBe('conn-azbuy');
    expect(result.externalIdentifierUsed).toBe('GOCASE123');
  });

  it('resolve "nao_identificada" quando nenhuma conexão bate com o idCadIntTran', () => {
    const azbuy = connection({ externalAccountId: 'GOCASE123' });

    const result = resolveOriginChannel(
      { intermediaryCnpj: '03007331000141', intermediaryIdCadIntTran: 'OUTRO999' },
      [azbuy],
    );

    expect(result.source).toBe('nao_identificada');
    expect(result.connection).toBeNull();
  });

  it('resolve "nao_identificada" quando a NF-e não traz idCadIntTran', () => {
    const azbuy = connection({ externalAccountId: 'GOCASE123' });

    const result = resolveOriginChannel(
      { intermediaryCnpj: '03007331000141', intermediaryIdCadIntTran: null },
      [azbuy],
    );

    expect(result.source).toBe('nao_identificada');
    expect(result.connection).toBeNull();
    expect(result.externalIdentifierUsed).toBeNull();
  });

  it('resolve "ambigua" quando mais de uma conexão tem o mesmo external_account_id', () => {
    const a = connection({ id: 'conn-a', externalAccountId: 'DUPLICADO' });
    const b = connection({ id: 'conn-b', externalAccountId: 'DUPLICADO' });

    const result = resolveOriginChannel(
      { intermediaryCnpj: '03007331000141', intermediaryIdCadIntTran: 'duplicado' },
      [a, b],
    );

    expect(result.source).toBe('ambigua');
    expect(result.connection).toBeNull();
    expect(result.candidates).toHaveLength(2);
  });

  it('nunca usa o CNPJ do intermediador para filtrar — só o expõe como evidência', () => {
    const azbuy = connection({ externalAccountId: 'GOCASE123' });

    const withCnpj = resolveOriginChannel(
      { intermediaryCnpj: '03007331000141', intermediaryIdCadIntTran: 'GOCASE123' },
      [azbuy],
    );
    const withoutCnpj = resolveOriginChannel(
      { intermediaryCnpj: null, intermediaryIdCadIntTran: 'GOCASE123' },
      [azbuy],
    );

    expect(withCnpj.connection?.id).toBe(withoutCnpj.connection?.id);
    expect(withCnpj.source).toBe(withoutCnpj.source);
  });
});

describe('describeOriginChannel', () => {
  const providerName = (key: string) => (key === 'mercado_livre' ? 'Mercado Livre' : key);

  it('"Canal não identificado" quando não há conexão resolvida', () => {
    const result = resolveOriginChannel({ intermediaryCnpj: null, intermediaryIdCadIntTran: null }, []);
    expect(describeOriginChannel(result, providerName)).toBe('Canal não identificado');
  });

  it('rótulo "identificado pelo intermediador" para resolução mapeada', () => {
    const azbuy = connection({ externalAccountId: 'GOCASE123', displayName: 'Mercado Livre / GoCase' });
    const result = resolveOriginChannel(
      { intermediaryCnpj: '03007331000141', intermediaryIdCadIntTran: 'GOCASE123' },
      [azbuy],
    );
    expect(describeOriginChannel(result, providerName)).toBe(
      'Mercado Livre — Mercado Livre / GoCase — identificado pelo intermediador'
    );
  });
});
