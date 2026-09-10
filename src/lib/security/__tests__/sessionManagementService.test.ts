import { describe, expect, it, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
const invoke = vi.fn();
vi.mock('../../supabase', () => ({
  supabase: { rpc, functions: { invoke } },
}));

const RAW_ROW = {
  session_id: 's1',
  user_id: 'u1',
  user_name: 'Ana',
  user_email: 'ana@empresa.com',
  user_role: 'admin',
  ip_address: '203.0.113.5',
  user_agent: 'Mozilla/5.0',
  created_at: '2026-08-01T00:00:00Z',
  refreshed_at: '2026-08-27T00:00:00Z',
  not_after: null,
  is_current: true,
  is_multi_company: false,
  total_count: 3,
};

describe('sessionManagementService', () => {
  beforeEach(() => {
    rpc.mockReset();
    invoke.mockReset();
  });

  it('listCompanySessions mapeia filtros "all" para null e devolve total_count', async () => {
    rpc.mockResolvedValueOnce({ data: [RAW_ROW], error: null });
    const { listCompanySessions } = await import('../sessionManagementService');

    const result = await listCompanySessions({ role: 'all', status: 'all', search: '  ', limit: 20, offset: 0 });

    expect(rpc).toHaveBeenCalledWith('admin_list_company_sessions', {
      p_search: null,
      p_role: null,
      p_status: null,
      p_limit: 20,
      p_offset: 0,
    });
    expect(result.totalCount).toBe(3);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toEqual({
      sessionId: 's1',
      userId: 'u1',
      userName: 'Ana',
      userEmail: 'ana@empresa.com',
      userRole: 'admin',
      ipAddress: '203.0.113.5',
      userAgent: 'Mozilla/5.0',
      createdAt: '2026-08-01T00:00:00Z',
      refreshedAt: '2026-08-27T00:00:00Z',
      notAfter: null,
      isCurrent: true,
      isMultiCompany: false,
    });
  });

  it('listCompanySessions nunca expõe access_token/refresh_token — o mapeamento só conhece os campos declarados', async () => {
    rpc.mockResolvedValueOnce({ data: [{ ...RAW_ROW, access_token: 'leak', refresh_token: 'leak' }], error: null });
    const { listCompanySessions } = await import('../sessionManagementService');

    const result = await listCompanySessions();

    expect(Object.keys(result.sessions[0])).not.toContain('accessToken');
    expect(Object.keys(result.sessions[0])).not.toContain('refreshToken');
    expect(JSON.stringify(result.sessions[0])).not.toMatch(/leak/);
  });

  it('totalCount é 0 quando a lista vem vazia', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    const { listCompanySessions } = await import('../sessionManagementService');
    const result = await listCompanySessions();
    expect(result.totalCount).toBe(0);
    expect(result.sessions).toEqual([]);
  });

  it('propaga erro do RPC como SessionManagementError com mensagem segura', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Apenas owner ou admin podem listar sessões.' } });
    const { listCompanySessions, SessionManagementError } = await import('../sessionManagementService');

    await expect(listCompanySessions()).rejects.toBeInstanceOf(SessionManagementError);
    await expect(listCompanySessions()).rejects.toThrow('Apenas owner ou admin podem listar sessões.');
  });

  it('erro sem mensagem cai para um texto genérico seguro, nunca undefined/vazio', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: {} });
    const { listCompanySessions } = await import('../sessionManagementService');
    await expect(listCompanySessions()).rejects.toThrow('Não foi possível concluir esta ação agora. Tente novamente.');
  });

  it('revokeSession chama a RPC com o session_id e motivo, e null quando motivo vazio', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    const { revokeSession } = await import('../sessionManagementService');
    await revokeSession('s1', '   ');
    expect(rpc).toHaveBeenCalledWith('admin_revoke_session', { p_session_id: 's1', p_reason: null });
  });

  it('revokeUserSessions retorna a quantidade revogada como número', async () => {
    rpc.mockResolvedValueOnce({ data: 4, error: null });
    const { revokeUserSessions } = await import('../sessionManagementService');
    const n = await revokeUserSessions('u1', 'dispositivo perdido');
    expect(n).toBe(4);
    expect(rpc).toHaveBeenCalledWith('admin_revoke_user_sessions', { p_user_id: 'u1', p_reason: 'dispositivo perdido' });
  });

  it('revokeCompanySessions envia a confirmação literal e mapeia revoked/skipped', async () => {
    rpc.mockResolvedValueOnce({ data: [{ revoked_count: 10, skipped_count: 2 }], error: null });
    const { revokeCompanySessions, COMPANY_REVOKE_CONFIRMATION } = await import('../sessionManagementService');
    const result = await revokeCompanySessions(COMPANY_REVOKE_CONFIRMATION, 'incidente');
    expect(rpc).toHaveBeenCalledWith('owner_revoke_company_sessions', {
      p_confirmation: 'ENCERRAR SESSÕES',
      p_reason: 'incidente',
    });
    expect(result).toEqual({ revokedCount: 10, skippedCount: 2 });
  });

  it('resolveSessionLocations deduplica ids e mapeia disponibilidade por sessão', async () => {
    invoke.mockResolvedValueOnce({
      data: { results: { s1: { available: true, city: 'São Paulo', region: 'SP', country: 'Brasil', country_code: 'BR' } } },
      error: null,
    });
    const { resolveSessionLocations } = await import('../sessionManagementService');

    const result = await resolveSessionLocations(['s1', 's1', 's2']);

    expect(invoke).toHaveBeenCalledWith('session-geolocation', { body: { session_ids: ['s1', 's2'] } });
    expect(result.s1).toEqual({ available: true, city: 'São Paulo', region: 'SP', country: 'Brasil', countryCode: 'BR' });
    expect(result.s2).toEqual({ available: false });
  });

  it('resolveSessionLocations nunca lança — falha da função vira "indisponível" para todas as sessões pedidas', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: 'edge function down' } });
    const { resolveSessionLocations } = await import('../sessionManagementService');

    const result = await resolveSessionLocations(['s1', 's2']);

    expect(result.s1.available).toBe(false);
    expect(result.s2.available).toBe(false);
  });

  it('resolveSessionLocations com lista vazia não chama a função', async () => {
    const { resolveSessionLocations } = await import('../sessionManagementService');
    const result = await resolveSessionLocations([]);
    expect(result).toEqual({});
    expect(invoke).not.toHaveBeenCalled();
  });
});
